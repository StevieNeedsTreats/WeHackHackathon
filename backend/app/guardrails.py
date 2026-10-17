"""Guardrails applied at every boundary of the pipeline.

Input  -> what a user may ask for (topic + injection screening).
Source -> which hosts agents may call, and how much they may read.
Model  -> LLM output must validate against a schema and quote the abstract verbatim.
Graph  -> writes are parameterised; ad-hoc Cypher is read-only, time-boxed, row-capped.
Output -> every insight ships with an evidence grade and a not-medical-advice notice.
"""

from __future__ import annotations

import re
import time
import unicodedata
from collections import defaultdict, deque
from dataclasses import dataclass

DISCLAIMER = (
    "TruthGraph summarises published research. It is not medical advice and does not "
    "replace a clinician. Evidence grades reflect the papers found, not certainty about you."
)

ALLOWED_HOSTS = {"www.ebi.ac.uk", "api.openalex.org"}
MAX_RESPONSE_BYTES = 6_000_000
MAX_ABSTRACT_CHARS = 6_000

_SUBSTANCE_RE = re.compile(r"^[a-z0-9][a-z0-9 \-+,.'()/&αβγω]{1,59}$", re.IGNORECASE)

# Requests that are about causing harm rather than understanding evidence.
_HARM_PATTERNS = [
    r"\b(lethal|fatal|deadly|toxic)\s+(dose|amount|quantity)",
    r"\bhow\s+(much|many).{0,30}\b(kill|die|overdose)",
    r"\b(overdose|od)\s+on\b",
    r"\bkill\s+(my|him|her|them|someone|a person)",
    r"\b(suicide|self[- ]harm)\b",
    r"\b(synthesi[sz]e|synthesis|cook|manufacture|extract)\b.{0,40}\b(meth|fentanyl|heroin|cocaine|lsd|mdma|ricin|sarin|nerve agent)",
    r"\b(poison|weaponi[sz]e)\b",
    r"\bundetectable\b",
]

_INJECTION_PATTERNS = [
    r"ignore (all |any |the )?(previous|prior|above) (instructions|prompts?)",
    r"disregard (the )?(system|previous)",
    r"\bsystem prompt\b",
    r"you are now",
    r"</?(system|assistant|user)>",
    r"\b(match|create|merge|delete|detach|set|remove|drop|call)\b\s*[\(\{]",
    r"\bgraph\.(query|ro_query|delete)\b",
]

_CRISIS_MESSAGE = (
    "This looks like it may be about self-harm. TruthGraph can't help with that, but people can: "
    "in the US call or text 988, in the UK call Samaritans on 116 123, or contact local emergency services."
)


@dataclass
class GuardrailResult:
    ok: bool
    value: str = ""
    code: str = ""
    message: str = ""
    checks: list[dict] | None = None


def screen_substance(raw: str) -> GuardrailResult:
    """Validate the one free-text input the product accepts."""
    checks: list[dict] = []
    text = unicodedata.normalize("NFKC", raw or "").strip()
    text = re.sub(r"\s+", " ", text)

    def check(name: str, passed: bool, detail: str) -> bool:
        checks.append({"name": name, "passed": passed, "detail": detail})
        return passed

    if not check("length", 2 <= len(text) <= 60, f"{len(text)} characters (2–60 allowed)"):
        return GuardrailResult(False, code="length", message="Enter a substance or intervention name between 2 and 60 characters.", checks=checks)

    lowered = text.lower()
    harmful = next((p for p in _HARM_PATTERNS if re.search(p, lowered)), None)
    if not check("harm intent", harmful is None, "no harm-seeking phrasing" if harmful is None else "harm-seeking phrasing"):
        crisis = re.search(r"suicide|self[- ]harm|kill (my|him|her)|overdose", lowered)
        return GuardrailResult(
            False,
            code="harm",
            message=_CRISIS_MESSAGE if crisis else "TruthGraph maps published evidence about substances. It can't help with requests aimed at causing harm.",
            checks=checks,
        )

    injected = next((p for p in _INJECTION_PATTERNS if re.search(p, lowered)), None)
    if not check("prompt / query injection", injected is None, "clean" if injected is None else "instruction-like text"):
        return GuardrailResult(False, code="injection", message="That input looks like instructions or a query rather than a substance name.", checks=checks)

    if not check("character set", bool(_SUBSTANCE_RE.match(text)), "letters, digits and - + , . ' ( ) / & only"):
        return GuardrailResult(False, code="charset", message="Use plain words for the substance, e.g. “creatine” or “vitamin D”.", checks=checks)

    if not check("not a URL or email", not re.search(r"https?:|www\.|@", lowered), "plain term"):
        return GuardrailResult(False, code="url", message="Enter a substance name, not a link.", checks=checks)

    return GuardrailResult(True, value=text, checks=checks)


def substance_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


# ---------------------------------------------------------------- model output


def verify_quote(quote: str, abstract: str) -> bool:
    """A claim's supporting quote must appear verbatim (modulo whitespace/case) in the source."""
    if not quote or len(quote) < 12:
        return False
    norm = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip().lower()
    return norm(quote) in norm(abstract)


def sanitize_for_prompt(text: str) -> str:
    """Abstracts are untrusted data. Strip markup and cap length before they reach a model."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_ABSTRACT_CHARS]


# ---------------------------------------------------------------- read-only cypher

_WRITE_KEYWORDS = re.compile(
    r"\b(create|merge|delete|detach|set|remove|drop|load\s+csv|foreach|call\s+db\.idx|call\s+dbms)\b",
    re.IGNORECASE,
)


def screen_cypher(q: str) -> GuardrailResult:
    q = (q or "").strip().rstrip(";")
    if not q:
        return GuardrailResult(False, code="empty", message="Query is empty.")
    if len(q) > 2000:
        return GuardrailResult(False, code="length", message="Query is longer than 2,000 characters.")
    if ";" in q:
        return GuardrailResult(False, code="multi", message="One statement at a time.")
    if _WRITE_KEYWORDS.search(q):
        return GuardrailResult(False, code="write", message="The console is read-only. Writes are made by the agents only.")
    if not re.match(r"^\s*(match|optional\s+match|with|unwind|return|call\s+db\.(labels|relationshiptypes|propertykeys))", q, re.IGNORECASE):
        return GuardrailResult(False, code="shape", message="Start with MATCH, OPTIONAL MATCH, WITH, UNWIND or RETURN.")
    return GuardrailResult(True, value=q)


# ---------------------------------------------------------------- rate limiting


class RateLimiter:
    """Sliding-window limiter per client key."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> tuple[bool, float]:
        now = time.monotonic()
        window = self.hits[key]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= self.per_minute:
            return False, 60 - (now - window[0])
        window.append(now)
        return True, 0.0
