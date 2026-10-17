"""Turning what a user hands in (a DOI, a link, a title with authors, or a file) into a paper.

Identifiers are looked up directly (OpenAlex, Europe PMC, ClinicalTrials.gov); a title is
matched against OpenAlex search results and only accepted when it clearly is one of them.
Any other link is fetched once to read the DOI or title from the page's citation metadata,
with private and internal addresses refused. Uploads are read as PDF or plain text.
All papers come out in the same normalised shape as search results (see sources._paper).
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import ipaddress
import re
import socket
from urllib.parse import unquote, urljoin, urlparse

import httpx

from .graph import title_norm
from .sources import SourceError, Sources, _paper, _surname

DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s\"'<>]+)", re.I)
NCT_RE = re.compile(r"\b(NCT\d{8})\b", re.I)
PMCID_RE = re.compile(r"\b(PMC\d{4,9})\b", re.I)
PMID_RE = re.compile(r"(?:pubmed\.ncbi\.nlm\.nih\.gov/|\bpmid:?\s*)(\d{4,9})", re.I)
ARXIV_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})", re.I)
OPENALEX_RE = re.compile(r"openalex\.org/(?:works/)?(W\d+)", re.I)

MAX_UPLOAD_BYTES = 15_000_000
MAX_PAGE_BYTES = 2_000_000
MAX_PDF_PAGES = 40
_STOP = {"the", "and", "for", "with", "from", "into", "among", "of", "in", "on", "a", "an", "to", "et", "al", "by"}


class Unresolved(Exception):
    """The reference couldn't be pinned to one paper. suggestions: close matches to offer instead."""

    def __init__(self, message: str, suggestions: list[dict] | None = None):
        super().__init__(message)
        self.suggestions = suggestions or []


def _clean_doi(doi: str) -> str:
    return unquote(doi).rstrip(".,;)]}>").removesuffix(".pdf").lower()


def has_text(p: dict) -> bool:
    return len(p.get("abstract") or "") >= 200


async def resolve_reference(sources: Sources, ref: str) -> dict:
    """A DOI, an identifier, a link or a title (with authors) -> one paper with an abstract."""
    ref = ref.strip()
    if m := NCT_RE.search(ref):
        p = await sources.trial(m[1].upper())
        if not p:
            raise Unresolved(f"No registered trial {m[1].upper()}")
        return p
    if m := OPENALEX_RE.search(ref):
        return await _need_text(sources, await sources.work_by_openalex(m[1]), ref)
    if m := ARXIV_RE.search(ref):
        return await by_doi(sources, f"10.48550/arxiv.{m[1]}")
    if m := DOI_RE.search(ref):
        return await by_doi(sources, _clean_doi(m[1]))
    if m := PMID_RE.search(ref):
        return await _need_text(sources, await sources.epmc_lookup(f"EXT_ID:{m[1]} AND SRC:MED"), ref)
    if m := PMCID_RE.search(ref):
        return await _need_text(sources, await sources.epmc_lookup(f"PMCID:{m[1].upper()}"), ref)
    if re.match(r"https?://", ref, re.I):
        meta = await page_meta(ref)
        if meta.get("pdf"):  # a direct PDF link: the caller reads it like an upload
            return {"pdf": meta["pdf"]}
        if meta.get("doi"):
            return await by_doi(sources, meta["doi"])
        if meta.get("title"):
            return await by_title(sources, meta["title"])
        raise Unresolved("That page has no citation details to go on. Paste the paper's DOI or title instead.")
    return await by_title(sources, ref)


async def by_doi(sources: Sources, doi: str) -> dict:
    oa, pmc = await asyncio.gather(sources.work_by_doi(doi), sources.epmc_lookup(f'DOI:"{doi}"'),
                                   return_exceptions=True)
    oa = oa if isinstance(oa, dict) else None
    pmc = pmc if isinstance(pmc, dict) else None
    p = oa or pmc
    if not p:
        raise Unresolved(f"No paper found for DOI {doi}")
    if oa and pmc:  # OpenAlex has the better metadata; Europe PMC often has the abstract and PMID
        oa = {**oa, "pmid": oa.get("pmid") or pmc.get("pmid"), "pmcid": pmc.get("pmcid")}
        if not has_text(oa) and has_text(pmc):
            oa["abstract"] = pmc["abstract"]
        p = oa
    return await _need_text(sources, p, doi)


async def _need_text(sources: Sources, p: dict | None, ref: str) -> dict:
    if not p:
        raise Unresolved(f"Couldn't find {ref}")
    if not has_text(p):
        raise Unresolved(f"Found “{p.get('title')}”, but no abstract is available for it. Upload the PDF instead.",
                         [suggestion(p)])
    return p


def _tokens(s: str) -> set[str]:
    return {w for w in title_norm(s).split() if len(w) > 2 and w not in _STOP}


def match_score(ref: str, cand: dict) -> float:
    """How surely `ref` names `cand`: share of the candidate's title words present in the
    reference, plus a little for a matching author surname or year."""
    tt, rt = _tokens(cand.get("title", "")), _tokens(ref)
    if not tt:
        return 0.0
    low = ref.lower()
    author = any(len(n) > 2 and n in low for n in (_surname(a["name"]).lower() for a in cand.get("authors", [])))
    year = bool(cand.get("year")) and str(cand["year"]) in ref
    return len(tt & rt) / len(tt) + 0.15 * author + 0.1 * year


def suggestion(p: dict) -> dict:
    return {"title": p.get("title"), "label": p.get("label"), "year": p.get("year"), "doi": p.get("doi"),
            "ref": p.get("doi") or p.get("title")}


async def by_title(sources: Sources, ref: str) -> dict:
    ref = ref.strip().strip("\"'“”")
    if len(_tokens(ref)) < 3:
        raise Unresolved("That's too short to identify a paper. Give the full title (and authors if you can), or a DOI.")
    # The broad search, plus title-only searches on the longest part of the reference (the title,
    # without the authors and year around it), in parallel; a source that fails is skipped.
    title = max(re.split(r",\s|\s[-–—]\s|\sby\s|\set al\b|\(", ref), key=lambda x: len(_tokens(x))).strip()
    results = await asyncio.gather(
        sources.openalex_candidates(ref), sources.openalex_candidates(title, title_only=True),
        sources.search_epmc(f'TITLE:"{title[:200]}"', 5), return_exceptions=True)
    cands: dict[str, dict] = {}
    for res in results:
        for c in res if isinstance(res, list) else []:
            prev = cands.get(c["id"])
            if prev is None or (not has_text(prev) and has_text(c)):
                cands[c["id"]] = c
    scored = sorted(((match_score(ref, c), c) for c in cands.values()), key=lambda t: -t[0])
    if not scored:
        raise Unresolved("No paper matches that title.")
    best_score, best = scored[0]
    runner = scored[1][0] if len(scored) > 1 else 0.0
    if best_score >= 0.85 and (best_score - runner >= 0.1 or best_score >= 1.05):
        if not has_text(best) and best.get("doi"):
            pmc = await sources.epmc_lookup(f'DOI:"{best["doi"]}"')
            if pmc and has_text(pmc):
                best = {**best, "abstract": pmc["abstract"], "pmid": best.get("pmid") or pmc.get("pmid")}
        return await _need_text(sources, best, ref)
    raise Unresolved("Couldn't tell which paper you mean.", [suggestion(c) for _, c in scored[:3]])


# ---------------------------------------------------------------------- arbitrary links


def _public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    return all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


async def page_meta(url: str) -> dict:
    """{doi, title} from a page's citation meta tags, or {pdf: bytes} when the link is a PDF.

    The page is untrusted: only public http(s) addresses are fetched (checked again on every
    redirect), the body is capped, and nothing but those tags is read from it.
    """
    async with httpx.AsyncClient(timeout=10, follow_redirects=False,
                                 headers={"User-Agent": "Mozilla/5.0 (TruthGraph citation lookup)",
                                          "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.5"}) as http:
        for _ in range(4):
            u = urlparse(url)
            if u.scheme not in ("http", "https") or not u.hostname:
                raise Unresolved("Only http(s) links are supported.")
            if not await asyncio.to_thread(_public, u.hostname):
                raise Unresolved("That address isn't reachable from here.")
            try:
                async with http.stream("GET", url) as r:
                    if r.is_redirect and r.headers.get("location"):
                        url = urljoin(url, r.headers["location"])
                        continue
                    if r.status_code >= 400:
                        raise Unresolved(f"The site answered {r.status_code}. Paste the paper's DOI or title instead.")
                    pdf = "pdf" in r.headers.get("content-type", "")
                    cap = MAX_UPLOAD_BYTES if pdf else MAX_PAGE_BYTES
                    body = bytearray()
                    async for chunk in r.aiter_bytes():
                        body += chunk
                        if len(body) > cap:
                            break
            except httpx.HTTPError as e:
                raise Unresolved(f"Couldn't open that link ({type(e).__name__}).") from e
            if pdf or body[:5] == b"%PDF-":
                return {"pdf": bytes(body)}
            return _citation_tags(body[:MAX_PAGE_BYTES].decode("utf-8", "ignore"))
    raise Unresolved("Too many redirects.")


def _meta(html: str, *names: str) -> str | None:
    for n in names:
        m = re.search(rf'<meta[^>]+(?:name|property)=["\']{re.escape(n)}["\'][^>]*content=["\']([^"\']+)', html, re.I) or \
            re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:name|property)=["\']{re.escape(n)}["\']', html, re.I)
        if m:
            return m[1].strip()
    return None


def _citation_tags(html: str) -> dict:
    doi = _meta(html, "citation_doi", "dc.identifier", "DC.Identifier", "prism.doi")
    if doi and (m := DOI_RE.search(doi)):
        doi = _clean_doi(m[1])
    elif m := DOI_RE.search(html[:200_000]):  # fall back to the first DOI-shaped link on the page
        doi = _clean_doi(m[1])
    else:
        doi = None
    title = _meta(html, "citation_title", "dc.title", "DC.title", "og:title")
    return {"doi": doi, "title": title}


# ---------------------------------------------------------------------- uploads


def read_upload(name: str, data: bytes) -> str:
    """Text of an uploaded PDF or text file. Blocking (PDF parsing); call it in a thread."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise Unresolved("Files are limited to 15 MB.")
    if data[:5] == b"%PDF-":
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages[:MAX_PDF_PAGES])
        except (PdfReadError, ValueError, KeyError) as e:
            raise Unresolved(f"Couldn't read {name}: {e}"[:200]) from e
    elif re.match(rb"\s*(<!doctype html|<html)", data[:200], re.I):
        raise Unresolved(f"{name} is a web page, not a paper (the site may have blocked the download). "
                         "Download the PDF in a browser, or paste its DOI.")
    elif name.lower().endswith((".txt", ".md", ".text")) or b"\x00" not in data[:4096]:
        text = data.decode("utf-8", "ignore")
    else:
        raise Unresolved(f"{name} isn't a PDF or a text file.")
    text = re.sub(r"[ \t]+", " ", text)
    if len(text.strip()) < 400:
        raise Unresolved(f"No readable text in {name} (a scanned PDF needs OCR first).")
    return text[:400_000]


_HEAD = r"(?:^|\n)\s*(?:\d+\.?\s*)?{}\s*[:\n]"


def focus_text(text: str, limit: int = 14_000) -> str:
    """The parts of a full paper that carry its results: abstract, results, conclusions.
    Falls back to the start of the text when there are no recognisable headings."""
    def section(names: str, n: int) -> str:
        m = re.search(_HEAD.format(names), text, re.I)
        return text[m.start():m.start() + n] if m else ""

    abstract = section("abstract|summary", 3000) or text[:3000]
    results = section("results|findings", 8000)
    conclusion = section("conclusions?|discussion", 2500)
    out = "\n\n".join(x.strip() for x in (abstract, results, conclusion) if x.strip())
    return (out if results else text)[:limit]


def doi_in(text: str) -> str | None:
    m = DOI_RE.search(text[:6000])
    return _clean_doi(m[1]) if m else None


def uploaded_paper(text: str, meta: dict | None, title: str | None = None, authors: list[str] | None = None,
                   year: int | None = None, journal: str | None = None) -> dict:
    """The paper for an upload: the metadata found for it (if any), with the uploaded text as the
    text the agents read. Without metadata the id is a hash of the text, so the same file is
    recognised when uploaded again."""
    body = focus_text(text)
    if meta:
        return {**meta, "abstract": body, "source": "upload"}
    names = [a for a in (authors or []) if a][:3]
    p = _paper(nct="upload", title=(title or "Untitled upload")[:300], year=year, journal=journal,
               authors=[{"id": f"name:{title_norm(a).replace(' ', '-')}", "name": a} for a in names],
               design="Other", citations=0, peer_reviewed=False, abstract=body, source="upload")
    p.update(id=f"upload:{hashlib.sha1(text[:50_000].encode()).hexdigest()[:12]}", nct=None,
             label=f"{_surname(names[0])} {year}" if names and year else (_surname(names[0]) if names else "Upload"))
    return p


__all__ = ["Unresolved", "SourceError", "resolve_reference", "by_doi", "by_title", "page_meta", "read_upload",
           "focus_text", "doi_in", "uploaded_paper", "suggestion"]
