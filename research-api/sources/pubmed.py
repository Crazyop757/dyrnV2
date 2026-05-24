"""
PubMed client (NCBI E-utilities).

Two-step flow:
  1. ESearch -> list of PMIDs matching the query
  2. ESummary -> bulk metadata for those PMIDs

PMIDs aren't directly usable for the graph (we'd need to resolve them through
S2 first), so PubMed papers join the /papers list but don't seed graph building.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)

BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def _summary_to_dict(rec: dict[str, Any], pmid: str) -> dict[str, Any]:
    authors = [a.get("name") for a in (rec.get("authors") or []) if a.get("name")]
    article_ids = rec.get("articleids") or []
    doi = next((a.get("value") for a in article_ids if a.get("idtype") == "doi"), None)
    pubdate = rec.get("pubdate") or ""
    year: int | None = None
    if pubdate:
        head = pubdate.split(" ", 1)[0]
        if head.isdigit():
            year = int(head)
    return {
        "id": f"PMID:{pmid}",
        "title": rec.get("title") or "(untitled)",
        "authors": authors,
        "abstract": None,  # ESummary doesn't include abstracts
        "year": year,
        "venue": rec.get("fulljournalname") or rec.get("source"),
        "citation_count": 0,  # not provided by PubMed
        "reference_count": 0,
        "doi": doi,
        "arxiv_id": None,
        "pdf_url": None,
        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        "tldr": None,
        "source": "pubmed",
    }


class PubMed:
    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("PUBMED_API_KEY") or None
        self.client = httpx.AsyncClient(
            base_url=BASE,
            headers={"User-Agent": "research-mvp/0.1"},
            timeout=30.0,
        )

    async def close(self) -> None:
        await self.client.aclose()

    def _params(self, **kwargs: Any) -> dict[str, Any]:
        p = {k: v for k, v in kwargs.items() if v is not None}
        if self.api_key:
            p["api_key"] = self.api_key
        return p

    async def search_papers(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        # Step 1: ESearch — get PMIDs.
        try:
            r1 = await self.client.get(
                "/esearch.fcgi",
                params=self._params(db="pubmed", term=query, retmax=limit, retmode="json"),
            )
        except httpx.HTTPError as e:
            log.warning("PubMed esearch failed: %s", e)
            return []
        if not r1.is_success:
            log.warning("PubMed esearch -> %d: %s", r1.status_code, r1.text[:200])
            return []
        pmids: list[str] = (((r1.json() or {}).get("esearchresult") or {}).get("idlist") or [])
        if not pmids:
            return []

        # Step 2: ESummary — bulk metadata for those PMIDs.
        try:
            r2 = await self.client.get(
                "/esummary.fcgi",
                params=self._params(db="pubmed", id=",".join(pmids), retmode="json"),
            )
        except httpx.HTTPError as e:
            log.warning("PubMed esummary failed: %s", e)
            return []
        if not r2.is_success:
            log.warning("PubMed esummary -> %d: %s", r2.status_code, r2.text[:200])
            return []
        result = (r2.json() or {}).get("result") or {}
        out: list[dict[str, Any]] = []
        for pmid in pmids:
            rec = result.get(pmid)
            if rec:
                out.append(_summary_to_dict(rec, pmid))
        return out
