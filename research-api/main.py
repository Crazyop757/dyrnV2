"""
Research-MVP backend.

Endpoints:
  GET  /health
  GET  /papers?topic=...&limit=15   -> merged list of papers from 4 sources
  GET  /graph?ids=id1,id2,...       -> nodes/edges for the relations graph
  POST /extract                     -> GROBID section extraction from PDFs
  GET  /verify-gap?query=...        -> S2 search to verify a research gap
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from extraction import extract_sections
from graph import build_graph
from sources.crossref import CrossRef
from sources.openalex import OpenAlex
from sources.pubmed import PubMed
from sources.semantic_scholar import SemanticScholar

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("research-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s2_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY") or None
    oa_email = os.environ.get("OPENALEX_EMAIL") or None
    cr_email = os.environ.get("CROSSREF_EMAIL") or None
    pm_key = os.environ.get("PUBMED_API_KEY") or None

    app.state.s2 = SemanticScholar(api_key=s2_key)
    app.state.oa = OpenAlex(email=oa_email)
    app.state.cr = CrossRef(email=cr_email)
    app.state.pm = PubMed(api_key=pm_key)

    log.info(
        "research-api ready (s2=%s, openalex=%s, crossref=%s, pubmed=%s)",
        bool(s2_key), bool(oa_email), bool(cr_email), bool(pm_key),
    )
    try:
        yield
    finally:
        await asyncio.gather(
            app.state.s2.close(),
            app.state.oa.close(),
            app.state.cr.close(),
            app.state.pm.close(),
        )


app = FastAPI(title="Research MVP API", version="0.1.0", lifespan=lifespan)

# The web frontend talks to us from the browser, so CORS must be permissive.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_TITLE_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _title_slug(t: str | None) -> str:
    if not t:
        return ""
    return _TITLE_SLUG_RE.sub("", t.lower())[:80]


def _merge_papers(
    s2: list[dict[str, Any]],
    oa: list[dict[str, Any]],
    cr: list[dict[str, Any]],
    pm: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """Merge four ranked source lists into one, deduping by DOI then title.

    Strategy:
      1. Front-load with the top S2 results, capped at ~40% of `limit`, so the
         graph endpoint always has enough seed IDs to expand.
      2. Fill remaining slots by round-robin across all four sources so each
         contributes something — this surfaces complementary coverage that pure
         relevance-ranking would hide (e.g. CrossRef journal articles missing
         from S2; PubMed biomedical-only papers).
    """
    seen_dois: set[str] = set()
    seen_titles: set[str] = set()
    merged: list[dict[str, Any]] = []

    def _try_add(p: dict[str, Any]) -> bool:
        doi = (p.get("doi") or "").lower().strip() or None
        tslug = _title_slug(p.get("title"))
        if doi and doi in seen_dois:
            return False
        if not doi and tslug and tslug in seen_titles:
            return False
        if doi:
            seen_dois.add(doi)
        if tslug:
            seen_titles.add(tslug)
        merged.append(p)
        return True

    # 1. Reserve roughly 40% of the list for S2 (graph seeds).
    s2_reserve = max(3, min(len(s2), limit * 2 // 5))
    for p in s2[:s2_reserve]:
        _try_add(p)
        if len(merged) >= limit:
            return merged

    # 2. Round-robin across remaining S2 + other sources to fill the rest.
    queues = [s2[s2_reserve:], oa, cr, pm]
    while len(merged) < limit:
        progressed = False
        for q in queues:
            while q:
                p = q.pop(0)
                if _try_add(p):
                    progressed = True
                    break
            if len(merged) >= limit:
                return merged
        if not progressed:
            break
    return merged


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok"}


@app.get("/papers")
async def papers(
    topic: str = Query(..., min_length=2),
    limit: int = Query(15, ge=1, le=50),
) -> dict[str, Any]:
    """Return up to `limit` papers for the given topic, merged across 4 sources.

    Sources run in parallel; results are deduped by DOI (or normalized title
    when DOI is missing). S2 results are kept first so the graph endpoint
    has seed IDs to expand.
    """
    # Each source returns more than the final `limit` so the merger has room
    # to dedupe and still hit the cap.
    per_source = limit + 5

    results = await asyncio.gather(
        app.state.s2.search_papers(topic, limit=per_source),
        app.state.oa.search_papers(topic, limit=per_source),
        app.state.cr.search_papers(topic, limit=per_source),
        app.state.pm.search_papers(topic, limit=per_source),
        return_exceptions=True,
    )

    def _safe(r: Any, name: str) -> list[dict[str, Any]]:
        if isinstance(r, BaseException):
            log.warning("Source %s failed: %s", name, r)
            return []
        return r

    s2_papers = _safe(results[0], "semantic_scholar")
    oa_papers = _safe(results[1], "openalex")
    cr_papers = _safe(results[2], "crossref")
    pm_papers = _safe(results[3], "pubmed")

    merged = _merge_papers(s2_papers, oa_papers, cr_papers, pm_papers, limit=limit)
    if not merged:
        raise HTTPException(status_code=502, detail="No papers found from any source.")

    counts = {
        "semantic_scholar": len(s2_papers),
        "openalex": len(oa_papers),
        "crossref": len(cr_papers),
        "pubmed": len(pm_papers),
        "merged": len(merged),
    }
    log.info("papers(%r) source counts: %s", topic, counts)
    return {"topic": topic, "papers": merged, "source_counts": counts}


@app.get("/graph")
async def graph(
    ids: str = Query(..., description="Comma-separated paper IDs (from /papers)."),
    top_n: int = Query(30, ge=5, le=100),
    min_edge: float = Query(0.05, ge=0.0, le=1.0),
) -> dict[str, Any]:
    """Return nodes/edges for the relations graph.

    Only Semantic Scholar IDs (no prefix) can seed the graph — OpenAlex (OA:),
    CrossRef (DOI:), and PubMed (PMID:) IDs are filtered out because graph
    building uses S2's references/citations endpoints.
    """
    raw_ids = [i.strip() for i in ids.split(",") if i.strip()]
    seed_ids = [i for i in raw_ids if not any(i.startswith(p) for p in ("OA:", "DOI:", "PMID:"))]
    if not seed_ids:
        raise HTTPException(
            status_code=400,
            detail="No Semantic Scholar IDs in the request — cannot build a graph.",
        )

    # Cap to keep the response under 30s in the worst case.
    seed_ids = seed_ids[:8]
    return await build_graph(app.state.s2, seed_ids, top_n=top_n, min_edge=min_edge)


class ExtractRequest(BaseModel):
    papers: list[dict[str, Any]]


@app.post("/extract")
async def extract(body: ExtractRequest) -> dict[str, Any]:
    """Extract limitations/future-work/conclusions from papers with open-access PDFs.

    Sends each PDF to the GROBID service and parses TEI XML. Papers without
    pdf_url are skipped — the caller should fall back to abstract-only analysis.
    """
    sections = await extract_sections(body.papers)
    return {"sections": sections}


@app.get("/verify-gap")
async def verify_gap(
    query: str = Query(..., min_length=2),
) -> dict[str, Any]:
    """Search Semantic Scholar for a gap query and return a confidence verdict."""
    results = await app.state.s2.search_papers(query, limit=20)
    total = len(results)

    if total <= 2:
        confidence = "confirmed"
    elif total <= 10:
        confidence = "partial"
    else:
        confidence = "unlikely"

    return {
        "query": query,
        "total": total,
        "confidence": confidence,
        "papers": [
            {"title": r["title"], "year": r.get("year"), "url": r.get("url")}
            for r in results[:3]
        ],
    }
