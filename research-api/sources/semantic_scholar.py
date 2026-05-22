"""
Semantic Scholar client — simplified port of Academix's clients/semantic.py
and SpiderPDF's pipeline/sources.py.

Only the calls we need for the MVP:
  - search_papers(topic): paper list for the /papers endpoint
  - get_papers_batch(ids): bulk metadata for graph nodes
  - get_references(paper_id) / get_citations(paper_id): for graph edges
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)

BASE = "https://api.semanticscholar.org/graph/v1"
PAPER_FIELDS = (
    "paperId,title,abstract,year,venue,authors.name,"
    "citationCount,referenceCount,externalIds,openAccessPdf,url"
)
# S2 free tier is ~1 req/sec across endpoints. With a key the published limit
# is ~100 req/sec — we sleep a small amount anyway to avoid bursting.
_RATE_SLEEP_FREE = 1.1
_RATE_SLEEP_KEYED = 0.05


def _to_dict(p: dict[str, Any]) -> dict[str, Any]:
    """Normalize an S2 paper object to the shape our endpoints return."""
    ext = p.get("externalIds") or {}
    oa = p.get("openAccessPdf") or {}
    return {
        "id": p.get("paperId") or "",
        "title": p.get("title") or "(untitled)",
        "authors": [a.get("name") for a in (p.get("authors") or []) if a.get("name")],
        "abstract": p.get("abstract"),
        "year": p.get("year"),
        "venue": p.get("venue"),
        "citation_count": p.get("citationCount") or 0,
        "reference_count": p.get("referenceCount") or 0,
        "doi": ext.get("DOI"),
        "arxiv_id": ext.get("ArXiv"),
        "pdf_url": oa.get("url"),
        "url": p.get("url"),
        "source": "semantic_scholar",
    }


class SemanticScholar:
    def __init__(self, api_key: str | None = None) -> None:
        headers = {"User-Agent": "research-mvp/0.1"}
        if api_key:
            headers["x-api-key"] = api_key
        self.client = httpx.AsyncClient(base_url=BASE, headers=headers, timeout=60.0)
        self._lock = asyncio.Lock()
        self._last_call = 0.0
        self._rate_sleep = _RATE_SLEEP_KEYED if api_key else _RATE_SLEEP_FREE

    async def close(self) -> None:
        await self.client.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response | None:
        # Serialize requests + sleep — S2 free tier is strict about concurrent calls.
        async with self._lock:
            loop = asyncio.get_event_loop()
            wait = self._rate_sleep - (loop.time() - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            for attempt in range(4):
                try:
                    r = await self.client.request(method, path, **kwargs)
                except httpx.HTTPError as e:
                    log.warning("S2 %s %s failed: %s", method, path, e)
                    return None
                self._last_call = loop.time()
                if r.status_code == 429:
                    await asyncio.sleep(2**attempt)
                    continue
                if r.status_code == 404:
                    return None
                if r.is_success:
                    return r
                log.warning("S2 %s %s -> %d: %s", method, path, r.status_code, r.text[:200])
                return None
            return None

    async def search_papers(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        r = await self._request(
            "GET",
            "/paper/search",
            params={"query": query, "limit": min(limit, 100), "fields": PAPER_FIELDS},
        )
        if r is None:
            return []
        data = (r.json() or {}).get("data") or []
        return [_to_dict(p) for p in data if p.get("paperId")]

    async def get_papers_batch(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        """Batch lookup, up to ~500 ids per call per S2 docs."""
        if not ids:
            return {}
        out: dict[str, dict[str, Any]] = {}
        # POST /paper/batch is the fast path.
        for chunk_start in range(0, len(ids), 400):
            chunk = ids[chunk_start : chunk_start + 400]
            r = await self._request(
                "POST",
                "/paper/batch",
                params={"fields": PAPER_FIELDS},
                json={"ids": chunk},
            )
            if r is None:
                continue
            for item in r.json() or []:
                if item and item.get("paperId"):
                    d = _to_dict(item)
                    out[d["id"]] = d
        return out

    async def get_links_batch(
        self, ids: list[str]
    ) -> dict[str, tuple[set[str], set[str]]]:
        """Bulk-fetch (references, citers) for many papers in one call per chunk.

        The S2 batch endpoint accepts up to 500 IDs and can return nested
        references/citations fields — this lets us avoid one HTTP call per
        paper for graph building.
        """
        if not ids:
            return {}
        out: dict[str, tuple[set[str], set[str]]] = {}
        for start in range(0, len(ids), 400):
            chunk = ids[start : start + 400]
            r = await self._request(
                "POST",
                "/paper/batch",
                params={"fields": "paperId,references.paperId,citations.paperId"},
                json={"ids": chunk},
            )
            if r is None:
                continue
            for item in r.json() or []:
                if not item or not item.get("paperId"):
                    continue
                pid = item["paperId"]
                refs = {
                    (ref or {}).get("paperId")
                    for ref in (item.get("references") or [])
                    if (ref or {}).get("paperId")
                }
                citers = {
                    (cit or {}).get("paperId")
                    for cit in (item.get("citations") or [])
                    if (cit or {}).get("paperId")
                }
                out[pid] = (refs, citers)
        return out

    async def get_references(self, paper_id: str, limit: int = 200) -> list[str]:
        """IDs of papers that paper_id cites."""
        r = await self._request(
            "GET",
            f"/paper/{paper_id}/references",
            params={"limit": min(limit, 1000), "fields": "paperId"},
        )
        if r is None:
            return []
        out: list[str] = []
        for item in (r.json() or {}).get("data") or []:
            cited = (item or {}).get("citedPaper") or {}
            pid = cited.get("paperId")
            if pid:
                out.append(pid)
        return out

    async def get_citations(self, paper_id: str, limit: int = 200) -> list[str]:
        """IDs of papers that cite paper_id."""
        r = await self._request(
            "GET",
            f"/paper/{paper_id}/citations",
            params={"limit": min(limit, 1000), "fields": "paperId"},
        )
        if r is None:
            return []
        out: list[str] = []
        for item in (r.json() or {}).get("data") or []:
            citing = (item or {}).get("citingPaper") or {}
            pid = citing.get("paperId")
            if pid:
                out.append(pid)
        return out
