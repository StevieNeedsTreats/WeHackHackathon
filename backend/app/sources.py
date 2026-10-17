"""External literature sources (Europe PMC for papers, OpenAlex for the citation graph).

Every request goes through `fetch_json`, which enforces the host allow-list, a
response-size cap, timeouts with retry, and a shared Redis cache that lives in the
same FalkorDB instance — so parallel agents never fetch the same thing twice.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from urllib.parse import quote, urlparse

import httpx
from redis.asyncio import Redis

from .config import get_settings
from .guardrails import ALLOWED_HOSTS, MAX_RESPONSE_BYTES

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
OPENALEX = "https://api.openalex.org/works"


class SourceError(RuntimeError):
    pass


class Sources:
    def __init__(self) -> None:
        s = get_settings()
        self.settings = s
        self.redis = Redis(host=s.falkor_host, port=s.falkor_port)
        self.http = httpx.AsyncClient(
            timeout=s.http_timeout_s,
            headers={"User-Agent": "TruthGraph/1.0 (evidence-graph research tool)"},
            follow_redirects=False,
        )
        self._inflight: dict[str, asyncio.Future] = {}
        self.stats = {"requests": 0, "cache_hits": 0}

    async def close(self) -> None:
        await self.http.aclose()
        await self.redis.aclose()

    async def fetch_json(self, url: str) -> dict:
        host = urlparse(url).hostname
        if host not in ALLOWED_HOSTS:
            raise SourceError(f"host not allowed: {host}")
        key = "tg:http:" + hashlib.sha1(url.encode()).hexdigest()
        cached = await self.redis.get(key)
        if cached:
            self.stats["cache_hits"] += 1
            return json.loads(cached)
        # Coalesce identical in-flight requests from parallel agents.
        if key in self._inflight:
            self.stats["cache_hits"] += 1
            return await self._inflight[key]
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[key] = fut
        try:
            data = await self._get(url)
            await self.redis.set(key, json.dumps(data), ex=self.settings.cache_ttl_s)
            fut.set_result(data)
            return data
        except Exception as e:
            fut.set_exception(e)
            fut.exception()  # mark retrieved
            raise
        finally:
            self._inflight.pop(key, None)

    async def _get(self, url: str) -> dict:
        last: Exception | None = None
        for attempt in range(3):
            try:
                self.stats["requests"] += 1
                r = await self.http.get(url)
                if r.status_code == 429 or r.status_code >= 500:
                    raise SourceError(f"{r.status_code} from {urlparse(url).hostname}")
                r.raise_for_status()
                if len(r.content) > MAX_RESPONSE_BYTES:
                    raise SourceError("response too large")
                return r.json()
            except (httpx.HTTPError, SourceError, ValueError) as e:
                last = e
                await asyncio.sleep(0.6 * (2**attempt))
        raise SourceError(str(last))

    # ------------------------------------------------------------------ Europe PMC

    async def search_epmc(self, query: str, size: int) -> list[dict]:
        url = (
            f"{EPMC}?query={quote(query)}&resultType=core&format=json"
            f"&pageSize={size}&sort={quote('CITED desc')}"
        )
        data = await self.fetch_json(url)
        return data.get("resultList", {}).get("result", [])

    # ------------------------------------------------------------------ OpenAlex

    async def citation_links(self, pmids: list[str]) -> list[tuple[str, str]]:
        """Return (citing_pmid, cited_pmid) pairs inside the given set."""
        if len(pmids) < 2:
            return []
        url = (
            f"{OPENALEX}?filter=pmid:{'|'.join(pmids[:50])}"
            f"&select=id,ids,referenced_works&per-page=50"
        )
        data = await self.fetch_json(url)
        by_oa: dict[str, str] = {}
        refs: dict[str, list[str]] = {}
        for w in data.get("results", []):
            pm = (w.get("ids") or {}).get("pmid", "")
            pm = pm.rsplit("/", 1)[-1]
            if not pm:
                continue
            by_oa[w["id"]] = pm
            refs[pm] = w.get("referenced_works") or []
        return [(src, by_oa[r]) for src, rs in refs.items() for r in rs if r in by_oa and by_oa[r] != src]


# ---------------------------------------------------------------------- parsing

_INDUSTRY = re.compile(
    r"\b(inc|ltd|llc|gmbh|corp|corporation|co\.|company|pharma|pharmaceuticals?|ag|s\.a\.|plc|nutrition(al)? (products|ltd)|labs?|industries|biotech|alzchem|glanbia|nestl[eé]|abbott|pfizer|novartis|bayer|merck|roche|gsk|sanofi)\b",
    re.I,
)
_PUBLIC = re.compile(
    r"\b(nih|national|ministry|council|government|federal|department of|nhmrc|nsf|wellcome|eu|european|research council|veterans|cdc|fapesp|cnpq|capes|jsps|nsfc)\b",
    re.I,
)
_NONPROFIT = re.compile(r"\b(university|universit|college|foundation|institute|society|trust|charity|hospital|association)\b", re.I)
# Industry-funded trade bodies are classified as industry.
_TRADE = re.compile(r"\b(council for responsible nutrition|dairy council|sugar association|beverage association)\b", re.I)


def classify_funder(name: str) -> str:
    if _TRADE.search(name) or _INDUSTRY.search(name):
        return "industry"
    if _PUBLIC.search(name):
        return "public"
    if _NONPROFIT.search(name):
        return "academic"
    return "other"


_DESIGN_ORDER = [
    ("meta-analysis", "Meta-analysis"),
    ("systematic review", "Systematic review"),
    ("randomized controlled trial", "RCT"),
    ("clinical trial", "Clinical trial"),
    ("observational study", "Observational"),
    ("comparative study", "Observational"),
    ("review", "Review"),
    ("case reports", "Case report"),
]


def detect_design(pub_types: list[str], title: str) -> str:
    low = [p.lower() for p in pub_types]
    t = title.lower()
    if "meta-analysis" in t or "meta analysis" in t:
        return "Meta-analysis"
    if "systematic review" in t:
        return "Systematic review"
    for key, label in _DESIGN_ORDER:
        if any(key == p or key in p for p in low):
            return label
    if re.search(r"randomi[sz]ed", t):
        return "RCT"
    return "Other"


_N_PATTERNS = [
    r"\b[nN]\s*=\s*(\d{1,3}(?:[, ]\d{3})+|\d{1,6})\b",
    r"\b(\d{1,3}(?:[, ]\d{3})+|\d{1,6})\s+(?:healthy\s+|older\s+|young\s+|elderly\s+|male\s+|female\s+|adult\s+|untrained\s+|trained\s+|resistance-trained\s+)*(?:participants|subjects|patients|adults|men|women|volunteers|athletes|individuals|children|players|people)\b",
]


def detect_sample(abstract: str, design: str) -> tuple[int | None, int | None]:
    """(participants, studies) — meta-analyses report pooled studies too."""
    participants = None
    for p in _N_PATTERNS:
        nums = [int(m.replace(",", "").replace(" ", "")) for m in re.findall(p, abstract)]
        nums = [n for n in nums if 4 <= n <= 500_000]
        if nums:
            participants = max(nums)
            break
    studies = None
    if design in {"Meta-analysis", "Systematic review", "Review"}:
        m = re.findall(r"\b(\d{1,4})\s+(?:randomi[sz]ed\s+)?(?:controlled\s+)?(?:studies|trials|RCTs|articles)\b", abstract)
        nums = [int(x) for x in m if 2 <= int(x) <= 5000]
        studies = max(nums) if nums else None
    return participants, studies


_COUNTRY_FIX = {"USA": "United States", "U.S.A": "United States", "UK": "United Kingdom", "PR China": "China",
                "People's Republic of China": "China", "The Netherlands": "Netherlands"}


def parse_affiliation(aff: str) -> tuple[str | None, str | None]:
    """(lab / institution, country) from a free-text affiliation string."""
    if not aff:
        return None, None
    aff = re.sub(r"\S+@\S+|Electronic address:?|\([^)]*\)?", "", aff).strip().rstrip(".;, ")
    parts = [x.strip() for x in re.split(r",", aff) if x.strip()]
    if not parts:
        return None, None
    country = re.sub(r"[\d\-]+", "", parts[-1]).strip().rstrip(".") or None
    if country and (len(country) > 40 or re.search(r"\b(university|department|institute|school)\b", country, re.I)):
        country = None
    country = _COUNTRY_FIX.get(country, country) if country else None
    inst = next((x for x in parts if re.search(r"universit|institut|college|hospital|school|centre|center|laborator|faculty", x, re.I)), parts[0])
    return inst[:90], country


def strip_tags(s: str) -> str:
    s = re.sub(r"<h4>(.*?)</h4>", r" \1: ", s or "")
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_epmc(r: dict) -> dict | None:
    pmid = r.get("pmid")
    doi = r.get("doi")
    pid = pmid or (doi and f"doi:{doi}")
    abstract = strip_tags(r.get("abstractText", ""))
    if not pid or len(abstract) < 200:
        return None
    pub_types = (r.get("pubTypeList") or {}).get("pubType") or []
    title = strip_tags(r.get("title", "")).rstrip(".")
    design = detect_design(pub_types, title)
    participants, studies = detect_sample(abstract, design)
    mesh = [m.get("descriptorName", "") for m in (r.get("meshHeadingList") or {}).get("meshHeading", [])]
    authors = [a.get("fullName") for a in (r.get("authorList") or {}).get("author", []) if a.get("fullName")]
    grants = (r.get("grantsList") or {}).get("grant", [])
    funders, seen = [], set()
    for g in grants:
        name = (g.get("agency") or "").strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            funders.append({"name": name[:80], "type": classify_funder(name)})
    journal = ((r.get("journalInfo") or {}).get("journal") or {}).get("title") or r.get("bookOrReportDetails", {}).get("publisher")
    first_author = ((r.get("authorList") or {}).get("author") or [{}])[0]
    aff_list = (first_author.get("authorAffiliationDetailsList") or {}).get("authorAffiliation") or []
    lab, region = parse_affiliation((aff_list[0].get("affiliation") if aff_list else None) or r.get("affiliation", ""))
    first = authors[0].split(" ")[0] if authors else "Anon"
    year = int(r.get("pubYear") or 0) or None
    return {
        "id": pid,
        "pmid": pmid,
        "doi": doi,
        "title": title,
        "label": f"{first} {year}" if year else first,
        "year": year,
        "journal": journal,
        "design": design,
        "pub_types": pub_types,
        "sample_size": participants,
        "studies": studies,
        "citations": int(r.get("citedByCount") or 0),
        "peer_reviewed": r.get("source") != "PPR",
        "open_access": r.get("isOpenAccess") == "Y",
        "retracted": any("retract" in p.lower() for p in pub_types),
        "animal": "Animals" in mesh and "Humans" not in mesh,
        "lab": lab,
        "region": region,
        "abstract": abstract,
        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else f"https://doi.org/{doi}",
        "authors": authors,
        "funders": funders,
    }
