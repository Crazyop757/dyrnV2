"""
OpenAlex client — fallback when Semantic Scholar returns few/no results.
Simplified port of Academix's clients/openalex.py.

Only what we need: search_papers(topic).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)

BASE = "https://api.openalex.org"


def _reconstruct_abstract(inv: dict[str, list[int]] | None) -> str | None:
    if not inv:
        return None
    positions: list[tuple[int, str]] = []
    for word, idxs in inv.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort()
    return " ".join(w for _, w in positions) or None


def _to_dict(w: dict[str, Any]) -> dict[str, Any]:
    oa_id = (w.get("id") or "").rsplit("/", 1)[-1]
    venue = ((w.get("primary_location") or {}).get("source") or {}).get("display_name")
    doi = (w.get("doi") or "").replace("https://doi.org/", "") or None
    pdf_url = (w.get("primary_location") or {}).get("pdf_url")
    return {
        # Prefix to distinguish from Semantic Scholar IDs.
        "id": f"OA:{oa_id}" if oa_id else "",
        "title": w.get("title") or w.get("display_name") or "(untitled)",
        "authors": [
            (a.get("author") or {}).get("display_name")
            for a in (w.get("authorships") or [])
            if (a.get("author") or {}).get("display_name")
        ],
        "abstract": _reconstruct_abstract(w.get("abstract_inverted_index")),
        "year": w.get("publication_year"),
        "venue": venue,
        "citation_count": w.get("cited_by_count") or 0,
        "reference_count": len(w.get("referenced_works") or []),
        "doi": doi,
        "arxiv_id": None,
        "pdf_url": pdf_url,
        "url": w.get("id"),
        "tldr": None,
        "source": "openalex",
    }


class OpenAlex:
    def __init__(self, email: str | None = None) -> None:
        headers = {"User-Agent": f"research-mvp/0.1 (mailto:{email})" if email else "research-mvp/0.1"}
        self.email = email or os.environ.get("OPENALEX_EMAIL") or None
        self.client = httpx.AsyncClient(base_url=BASE, headers=headers, timeout=30.0)

    async def close(self) -> None:
        await self.client.aclose()

    async def search_papers(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"search": query, "per_page": min(limit, 200)}
        if self.email:
            params["mailto"] = self.email
        try:
            r = await self.client.get("/works", params=params)
        except httpx.HTTPError as e:
            log.warning("OpenAlex search failed: %s", e)
            return []
        if not r.is_success:
            log.warning("OpenAlex search -> %d: %s", r.status_code, r.text[:200])
            return []
        results = (r.json() or {}).get("results") or []
        return [_to_dict(w) for w in results][:limit]
