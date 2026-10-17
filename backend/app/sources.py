"""External literature sources.

  * Europe PMC        — biomedical papers with abstracts, MeSH and grants
  * ClinicalTrials.gov — registered trials, including unpublished and ongoing ones
  * OpenAlex          — every field: papers, abstracts, funders, institutions, citations

Every request goes through `fetch`, which enforces the host allow-list, a
response-size cap, timeouts with retry, and a shared Redis cache, so parallel
agents never fetch the same thing twice.
All sources return papers in one normalised shape (see `_paper`).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from urllib.parse import quote, urlencode, urlparse

import httpx
from redis.asyncio import Redis
from redis.exceptions import RedisError

from .config import get_settings
from .graph import slug
from .guardrails import ALLOWED_HOSTS, MAX_RESPONSE_BYTES

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
OPENALEX = "https://api.openalex.org/works"
CTGOV = "https://clinicaltrials.gov/api/v2/studies"

log = logging.getLogger(__name__)


class SourceError(RuntimeError):
    pass


class Sources:
    def __init__(self) -> None:
        s = get_settings()
        self.settings = s
        # Side storage (caches, abstracts, verdicts, run logs) lives in Redis, not in FalkorDB.
        self.redis = Redis.from_url(s.redis_url, socket_keepalive=True, health_check_interval=30)
        self.http = httpx.AsyncClient(
            timeout=s.http_timeout_s,
            headers={"User-Agent": "TruthGraph/2.0 (evidence-graph research tool)"},
            follow_redirects=False,
        )
        self._inflight: dict[str, asyncio.Future] = {}
        self.stats = {"requests": 0, "cache_hits": 0, "cache_errors": 0}

    async def close(self) -> None:
        await self.http.aclose()
        await self.redis.aclose()

    # ------------------------------------------------------------------ transport

    async def fetch(self, url: str, kind: str = "json"):
        host = urlparse(url).hostname
        if host not in ALLOWED_HOSTS:
            raise SourceError(f"host not allowed: {host}")
        key = f"tg:http:{kind}:" + hashlib.sha1(url.encode()).hexdigest()
        try:
            cached = await self.redis.get(key)
        except RedisError as e:  # the cache only saves requests; fetch without it
            self.stats["cache_errors"] += 1
            log.warning("HTTP cache read failed: %s", e)
            cached = None
        if cached:
            self.stats["cache_hits"] += 1
            return json.loads(cached) if kind == "json" else cached.decode()
        # Coalesce identical in-flight requests from parallel agents.
        if key in self._inflight:
            self.stats["cache_hits"] += 1
            return await self._inflight[key]
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._inflight[key] = fut
        try:
            data = await self._get(url, kind)
            try:
                await self.redis.set(key, json.dumps(data) if kind == "json" else data, ex=self.settings.cache_ttl_s)
            except RedisError as e:
                self.stats["cache_errors"] += 1
                log.warning("HTTP cache write failed: %s", e)
            fut.set_result(data)
            return data
        except Exception as e:
            fut.set_exception(e)
            fut.exception()  # mark retrieved
            raise
        finally:
            self._inflight.pop(key, None)

    async def _get(self, url: str, kind: str):
        last: Exception | None = None
        for attempt in range(3):
            try:
                self.stats["requests"] += 1
                r = await self.http.get(url)
                if r.status_code == 429 or r.status_code >= 500:
                    raise SourceError(f"{r.status_code} from {urlparse(url).hostname}")
                if r.status_code == 404:
                    raise SourceError("not found")
                r.raise_for_status()
                if len(r.content) > MAX_RESPONSE_BYTES:
                    raise SourceError("response too large")
                return r.json() if kind == "json" else r.text
            except SourceError as e:
                if str(e) == "not found":
                    raise
                last = e
            except (httpx.HTTPError, ValueError) as e:
                last = e
            await asyncio.sleep(0.6 * (2**attempt))
        raise SourceError(str(last))

    # ------------------------------------------------------------------ abstracts (Redis, not the graph)

    async def put_abstracts(self, papers: list[dict]) -> None:
        pipe = self.redis.pipeline()
        for p in papers:
            if p.get("abstract"):
                pipe.set(f"tg:abstract:{p['id']}", p["abstract"], ex=self.settings.cache_ttl_s * 4)
        await pipe.execute()

    async def get_abstract(self, paper_id: str) -> str:
        v = await self.redis.get(f"tg:abstract:{paper_id}")
        return v.decode() if v else ""

    # ------------------------------------------------------------------ search

    async def search(self, source: str, query: str, size: int) -> list[dict]:
        size = max(1, min(size, 25))
        if source == "europepmc":
            return await self.search_epmc(query, size)
        if source == "openalex":
            return await self.search_openalex(query, size)
        if source == "clinicaltrials":
            return await self.search_clinicaltrials(query, size)
        raise SourceError(f"unknown source {source}")

    async def search_epmc(self, query: str, size: int) -> list[dict]:
        # Default (relevance) order. Europe PMC matches full text, so sorting by citations
        # floats famous papers that merely mention a term (e.g. DrugBank) above on-topic ones.
        url = f"{EPMC}/search?query={quote(query + ' AND HAS_ABSTRACT:y')}&resultType=core&format=json&pageSize={size}"
        data = await self.fetch(url)
        return [p for p in (parse_epmc(r) for r in data.get("resultList", {}).get("result", [])) if p]

    async def search_openalex(self, query: str, size: int) -> list[dict]:
        params = {"search": query, "filter": "has_abstract:true,is_paratext:false", "per-page": size,
                  "sort": "relevance_score:desc"}
        if self.settings.contact_email:
            params["mailto"] = self.settings.contact_email
        data = await self.fetch(f"{OPENALEX}?{urlencode(params)}")
        return [p for p in (parse_openalex(w) for w in data.get("results", [])) if p]

    async def search_clinicaltrials(self, query: str, size: int) -> list[dict]:
        data = await self.fetch(f"{CTGOV}?{urlencode({'query.term': query, 'pageSize': size, 'format': 'json'})}")
        return [p for p in (parse_ctgov(s) for s in data.get("studies", [])) if p]

    async def fulltext(self, paper: dict) -> str:
        """Methods and results from Europe PMC open-access full text, when available."""
        pmcid = paper.get("pmcid")
        if not pmcid:
            return ""
        try:
            xml = await self.fetch(f"{EPMC}/{pmcid}/fullTextXML", kind="text")
        except SourceError:
            return ""
        secs = re.findall(r'<sec[^>]*sec-type="(methods|results|materials\|methods)"[^>]*>(.*?)</sec>', xml, re.S)
        text = " ".join(strip_tags(body) for _, body in secs) or strip_tags(xml)
        return text[:20_000]

    # ------------------------------------------------------------------ citations

    async def citation_links(self, papers: list[dict]) -> list[tuple[str, str]]:
        """(citing_id, cited_id) pairs inside the given set, via OpenAlex."""
        by_pmid = {p["pmid"]: p["id"] for p in papers if p.get("pmid")}
        by_oa = {p["openalex"]: p["id"] for p in papers if p.get("openalex")}
        if len(by_pmid) + len(by_oa) < 2:
            return []
        works: list[dict] = []
        for flt, keys in (("pmid", list(by_pmid)), ("ids.openalex", list(by_oa))):
            for i in range(0, len(keys), 50):
                if not keys[i:i + 50]:
                    continue
                params = {"filter": f"{flt}:{'|'.join(keys[i:i + 50])}", "select": "id,ids,referenced_works", "per-page": 50}
                if self.settings.contact_email:
                    params["mailto"] = self.settings.contact_email
                data = await self.fetch(f"{OPENALEX}?{urlencode(params)}")
                works += data.get("results", [])
        oa_to_ours: dict[str, str] = {}
        refs: dict[str, list[str]] = {}
        for w in works:
            wid = w["id"].rsplit("/", 1)[-1]
            pm = ((w.get("ids") or {}).get("pmid") or "").rsplit("/", 1)[-1]
            ours = by_oa.get(wid) or by_pmid.get(pm)
            if not ours:
                continue
            oa_to_ours[wid] = ours
            refs[ours] = [r.rsplit("/", 1)[-1] for r in w.get("referenced_works") or []]
        return sorted({(src, oa_to_ours[r]) for src, rs in refs.items() for r in rs
                       if r in oa_to_ours and oa_to_ours[r] != src})


# ---------------------------------------------------------------------- normalised paper


def _paper(*, pmid=None, doi=None, openalex=None, nct=None, **kw) -> dict:
    doi = (doi or "").lower().removeprefix("https://doi.org/") or None
    pid = (f"doi:{doi}" if doi else f"pmid:{pmid}" if pmid else f"oa:{openalex}" if openalex else f"nct:{nct}")
    authors = kw.pop("authors", [])
    first = _surname(authors[0]["name"]) if authors and not nct else (nct or "Anon")
    year = kw.get("year")
    return {
        "id": pid, "pmid": pmid, "doi": doi, "openalex": openalex, "nct": nct,
        "label": f"{first} {year}" if year and not nct else first, "authors": authors, "kind": "article",
        "peer_reviewed": True, "retracted": False, "animal": False, **kw,
    }


def _surname(name: str) -> str:
    """'Ostojic SM' -> Ostojic; 'David Neumark' -> Neumark."""
    tokens = name.replace(",", " ").split()
    if not tokens:
        return "Anon"
    if len(tokens) > 1 and tokens[-1].isupper() and len(tokens[-1]) <= 3:
        return tokens[0]
    return tokens[-1]


# ---------------------------------------------------------------------- Europe PMC

_INDUSTRY = re.compile(
    r"\b(inc|ltd|llc|gmbh|corp|corporation|co\.|company|pharma|pharmaceuticals?|ag|s\.a\.|plc|nutrition(al)? (products|ltd)|labs?|industries|biotech|alzchem|glanbia|nestl[eé]|abbott|pfizer|novartis|bayer|merck|roche|gsk|sanofi)\b",
    re.I,
)
_PUBLIC = re.compile(
    r"\b(nih|national|ministry|council|government|federal|department of|nhmrc|nsf|wellcome|eu|european|research council|veterans|cdc|fapesp|cnpq|capes|jsps|nsfc|commission)\b",
    re.I,
)
_NONPROFIT = re.compile(r"\b(university|universit|college|foundation|institute|society|trust|charity|hospital|association|center|centre)\b", re.I)
# Industry-funded trade bodies are classified as industry.
_TRADE = re.compile(r"\b(council for responsible nutrition|dairy council|sugar association|beverage association|chamber of commerce|restaurant association)\b", re.I)


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
    ("observational study", "Cohort"),
    ("comparative study", "Cohort"),
    ("case reports", "Case report"),
    ("review", "Review"),
]


def detect_design(pub_types: list[str], title: str) -> str:
    """A metadata hint only; the Extractor agent decides the design from the text."""
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
    abstract = strip_tags(r.get("abstractText", ""))
    if not (r.get("pmid") or r.get("doi")) or len(abstract) < 200:
        return None
    pub_types = (r.get("pubTypeList") or {}).get("pubType") or []
    title = strip_tags(r.get("title", "")).rstrip(".")
    mesh = [m.get("descriptorName", "") for m in (r.get("meshHeadingList") or {}).get("meshHeading", [])]
    authors = []
    for a in (r.get("authorList") or {}).get("author", [])[:3]:
        if not a.get("fullName"):
            continue
        aid = a.get("authorId") or {}
        authors.append({"id": f"orcid:{aid['value']}" if aid.get("type") == "ORCID" else f"name:{slug(a['fullName'])}",
                        "name": a["fullName"]})
    funders, seen = [], set()
    for g in (r.get("grantsList") or {}).get("grant", []):
        name = (g.get("agency") or "").strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            funders.append({"id": f"name:{slug(name)}", "name": name[:80], "type": classify_funder(name)})
    first_author = ((r.get("authorList") or {}).get("author") or [{}])[0]
    aff_list = (first_author.get("authorAffiliationDetailsList") or {}).get("authorAffiliation") or []
    lab, country = parse_affiliation((aff_list[0].get("affiliation") if aff_list else None) or r.get("affiliation", ""))
    journal = ((r.get("journalInfo") or {}).get("journal") or {}).get("title")
    pmid, doi = r.get("pmid"), r.get("doi")
    return _paper(
        pmid=pmid, doi=doi, title=title, year=int(r.get("pubYear") or 0) or None, journal=journal,
        design=detect_design(pub_types, title), citations=int(r.get("citedByCount") or 0),
        peer_reviewed=r.get("source") != "PPR", retracted=any("retract" in p.lower() for p in pub_types),
        animal="Animals" in mesh and "Humans" not in mesh, open_access=r.get("isOpenAccess") == "Y",
        pmcid=r.get("pmcid"), authors=authors, funders=funders,
        labs=[{"id": f"name:{slug(lab)}", "name": lab, "country": country or ""}] if lab else [],
        url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else f"https://doi.org/{doi}",
        abstract=abstract, source="europepmc",
    )


# ---------------------------------------------------------------------- OpenAlex


def _oa_abstract(inv: dict | None) -> str:
    if not inv:
        return ""
    pos: list[tuple[int, str]] = [(i, w) for w, idxs in inv.items() for i in idxs]
    return " ".join(w for _, w in sorted(pos))


_OA_DESIGNS = {"meta-analysis": "Meta-analysis", "systematic-review": "Systematic review",
               "randomized-controlled-trial": "RCT", "clinical-trial": "Clinical trial",
               "observational-study": "Observational", "case-report": "Case report", "review": "Review"}


def parse_openalex(w: dict) -> dict | None:
    abstract = _oa_abstract(w.get("abstract_inverted_index"))
    title = (w.get("title") or w.get("display_name") or "").strip()
    if len(abstract) < 200 or not title:
        return None
    oa = w["id"].rsplit("/", 1)[-1]
    pmid = ((w.get("ids") or {}).get("pmid") or "").rsplit("/", 1)[-1] or None
    authors, labs = [], []
    for a in (w.get("authorships") or [])[:3]:
        au = a.get("author") or {}
        if au.get("display_name"):
            authors.append({"id": f"oa:{au['id'].rsplit('/', 1)[-1]}" if au.get("id") else f"name:{slug(au['display_name'])}",
                            "name": au["display_name"]})
    for a in (w.get("authorships") or [])[:1]:
        for inst in (a.get("institutions") or [])[:2]:
            if inst.get("display_name"):
                labs.append({"id": f"oa:{inst['id'].rsplit('/', 1)[-1]}" if inst.get("id") else f"name:{slug(inst['display_name'])}",
                             "name": inst["display_name"][:90], "country": inst.get("country_code") or ""})
    funders = [{"id": f"oa:{f['id'].rsplit('/', 1)[-1]}", "name": f["display_name"][:80], "type": classify_funder(f["display_name"])}
               for f in (w.get("funders") or []) if f.get("id") and f.get("display_name")]
    src = (w.get("primary_location") or {}).get("source") or {}
    designs = [_OA_DESIGNS.get(d["id"].rsplit("/", 1)[-1]) for d in (w.get("study_designs") or []) if d.get("id")]
    design = next((d for d in designs if d), "Review" if w.get("type") == "review" else "Other")
    venue = src.get("type") or ""
    return _paper(
        pmid=pmid, doi=w.get("doi"), openalex=oa, title=title, year=w.get("publication_year"),
        journal=src.get("display_name"), design=design, citations=int(w.get("cited_by_count") or 0),
        peer_reviewed=venue in {"journal", "conference"} and w.get("type") not in {"preprint", "report"},
        retracted=bool(w.get("is_retracted")), open_access=bool((w.get("open_access") or {}).get("is_oa")),
        venue_type=venue, authors=authors, labs=labs, funders=funders,
        url=w.get("doi") or f"https://openalex.org/{oa}", abstract=abstract, source="openalex",
    )


# ---------------------------------------------------------------------- ClinicalTrials.gov


def parse_ctgov(s: dict) -> dict | None:
    p = s.get("protocolSection") or {}
    ident = p.get("identificationModule") or {}
    nct = ident.get("nctId")
    if not nct:
        return None
    desc = p.get("descriptionModule") or {}
    design = p.get("designModule") or {}
    status = p.get("statusModule") or {}
    sponsor = (p.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}
    outcomes = (p.get("outcomesModule") or {}).get("primaryOutcomes") or []
    conds = (p.get("conditionsModule") or {}).get("conditions") or []
    arms = (p.get("armsInterventionsModule") or {}).get("interventions") or []
    elig = p.get("eligibilityModule") or {}
    enrol = (design.get("enrollmentInfo") or {}).get("count")
    phases = ", ".join(design.get("phases") or [])
    summary = " ".join(x for x in [
        f"Registered {design.get('studyType', '').lower()} trial ({phases or 'phase n/a'}), status {status.get('overallStatus', '').lower()}.",
        f"Conditions: {', '.join(conds)}." if conds else "",
        f"Interventions: {', '.join(a.get('name', '') for a in arms)}." if arms else "",
        f"Primary outcomes: {'; '.join(o.get('measure', '') for o in outcomes[:3])}." if outcomes else "",
        f"Eligibility: sex {elig.get('sex', 'all').lower()}, ages {elig.get('minimumAge', '?')}–{elig.get('maximumAge', '?')}.",
        "Results have been posted." if s.get("hasResults") else "No results posted.",
        desc.get("briefSummary", ""),
    ] if x)
    year = int((status.get("startDateStruct") or {}).get("date", "0")[:4] or 0) or None
    sname = sponsor.get("name") or ""
    return _paper(
        nct=nct, title=ident.get("briefTitle") or nct, year=year, journal="ClinicalTrials.gov",
        design="Registered trial", sample_size=enrol, citations=0, peer_reviewed=False, kind="registry",
        authors=[{"id": f"name:{slug(sname)}", "name": sname}] if sname else [],
        funders=[{"id": f"name:{slug(sname)}", "name": sname[:80],
                  "type": "industry" if sponsor.get("class") == "INDUSTRY" else classify_funder(sname)}] if sname else [],
        url=f"https://clinicaltrials.gov/study/{nct}", abstract=summary[:6000], has_results=bool(s.get("hasResults")),
        source="clinicaltrials",
    )
