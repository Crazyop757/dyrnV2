"""
CrossRef client — broad coverage of journal articles via DOI registry.

Used as an extra source for /papers. CrossRef IDs aren't usable for the graph
(no citation/reference network), so these papers populate the list but don't
seed graph building.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)

BASE = "https://api.crossref.org"


def _to_dict(item: dict[str, Any]) -> dict[str, Any]:
    titles = item.get("title") or []
    container = item.get("container-title") or []
    authors_raw = item.get("author") or []
    authors = []
    for a in authors_raw:
        name = " ".join(filter(None, [a.get("given"), a.get("family")])).strip()
        if name:
            authors.append(name)
    issued = (item.get("issued") or {}).get("date-parts") or [[None]]
    year = issued[0][0] if issued and issued[0] else None
    doi = item.get("DOI")
    return {
        "id": f"DOI:{doi}" if doi else "",
        "title": titles[0] if titles else "(untitled)",
        "authors": authors,
        "abstract": item.get("abstract"),
        "year": year,
        "venue": container[0] if container else None,
        "citation_count": item.get("is-referenced-by-count") or 0,
        "reference_count": item.get("references-count") or 0,
        "doi": doi,
        "arxiv_id": None,
        "pdf_url": None,
        "url": item.get("URL"),
        "source": "crossref",
    }


class CrossRef:
    def __init__(self, email: str | None = None) -> None:
        self.email = email or os.environ.get("CROSSREF_EMAIL") or None
        ua = f"research-mvp/0.1 (mailto:{self.email})" if self.email else "research-mvp/0.1"
        self.client = httpx.AsyncClient(base_url=BASE, headers={"User-Agent": ua}, timeout=30.0)

    async def close(self) -> None:
        await self.client.aclose()

    async def search_papers(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"query": query, "rows": min(limit, 50)}
        if self.email:
            params["mailto"] = self.email
        try:
            r = await self.client.get("/works", params=params)
        except httpx.HTTPError as e:
            log.warning("CrossRef search failed: %s", e)
            return []
        if not r.is_success:
            log.warning("CrossRef search -> %d: %s", r.status_code, r.text[:200])
            return []
        items = ((r.json() or {}).get("message") or {}).get("items") or []
        return [_to_dict(it) for it in items if it.get("DOI")][:limit]
