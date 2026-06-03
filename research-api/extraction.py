"""
PDF section extraction — returns sentence-level quotes.

Fetches open-access PDFs, extracts raw text, finds limitations/future-work/conclusions
sections by heading keyword matching, and returns key sentences.
Falls back to abstract-based extraction for papers without a PDF.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx
import fitz  # pymupdf

log = logging.getLogger(__name__)

_HEADING_KEYWORDS = {
    "limitations": re.compile(r"limitation", re.IGNORECASE),
    "future_work": re.compile(r"future\s+(?:work|direction|research)", re.IGNORECASE),
    "conclusions": re.compile(r"conclusion|discussion|concluding", re.IGNORECASE),
}

# Words that signal a limitation-type sentence in an abstract
_LIMITATION_CUES = re.compile(
    r"\b(limitation|limited|however|although|despite|caveat|weakness|"
    r"future work|not consider|cannot|unable|lack|shortcoming|constraint|"
    r"only consider|restricted to|does not|did not address)\b",
    re.IGNORECASE,
)


def _is_heading_line(line: str) -> str | None:
    stripped = line.strip()
    if not stripped or len(stripped) > 120 or len(stripped) < 4:
        return None
    if stripped.endswith(".") and not re.match(r"^\d+\.\s", stripped):
        return None
    for key in ("limitations", "future_work", "conclusions"):
        if _HEADING_KEYWORDS[key].search(stripped):
            return key
    return None


def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    parts = []
    for page in doc:
        parts.append(page.get_text())
    doc.close()
    return "\n".join(parts)


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences, filtering short/noisy ones."""
    raw = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    return [s.strip() for s in raw if len(s.strip()) > 30]


def _find_section_sentences(text: str) -> dict[str, list[str]]:
    """Find limitation/future-work/conclusions sections and return key sentences."""
    sections: dict[str, list[str]] = {
        "limitations": [],
        "future_work": [],
        "conclusions": [],
    }

    lines = text.split("\n")
    heading_positions: list[tuple[int, str]] = []

    for i, line in enumerate(lines):
        key = _is_heading_line(line)
        if key:
            heading_positions.append((i, key))

    for idx, (line_no, key) in enumerate(heading_positions):
        if sections[key]:  # already filled from an earlier heading
            continue
        start = line_no + 1
        if idx + 1 < len(heading_positions):
            end = heading_positions[idx + 1][0]
        else:
            end = min(start + 80, len(lines))

        body = " ".join(lines[start:end]).strip()
        if len(body) < 40:
            continue

        sentences = _split_sentences(body)
        # Keep sentences that look substantive (not just "In this paper we…")
        kept = [s[:400] for s in sentences[:15] if len(s) > 40][:5]
        sections[key] = kept

    return sections


def _abstract_limitations(abstract: str | None) -> list[str]:
    """Mine limitation-indicating sentences from an abstract (fallback when no PDF)."""
    if not abstract:
        return []
    sentences = _split_sentences(abstract)
    return [s[:400] for s in sentences if _LIMITATION_CUES.search(s)][:3]


async def _fetch_and_extract(
    client: httpx.AsyncClient,
    paper_id: str,
    pdf_url: str,
) -> tuple[str, dict[str, list[str]]]:
    empty: dict[str, list[str]] = {"limitations": [], "future_work": [], "conclusions": []}
    try:
        resp = await client.get(pdf_url, follow_redirects=True, timeout=30.0)
        if resp.status_code != 200:
            log.warning("PDF download failed for %s: %d", paper_id, resp.status_code)
            return paper_id, empty
    except httpx.HTTPError as e:
        log.warning("PDF download error for %s: %s", paper_id, e)
        return paper_id, empty

    if not resp.content[:5].startswith(b"%PDF"):
        log.warning("Response for %s is not a PDF", paper_id)
        return paper_id, empty

    try:
        text = _extract_text_from_pdf(resp.content)
        sections = _find_section_sentences(text)
        return paper_id, sections
    except Exception as e:
        log.warning("PDF parse error for %s: %s", paper_id, e)
        return paper_id, empty


async def extract_sections(
    papers: list[dict[str, Any]],
) -> dict[str, dict[str, list[str]]]:
    """Extract limitations/future-work/conclusions for all papers.

    - Papers with pdf_url: PDF section extraction (sentence-level quotes).
    - Papers without pdf_url: abstract-based limitation mining (fallback).
    Returns {paper_id: {limitations: [str], future_work: [str], conclusions: [str]}}.
    """
    out: dict[str, dict[str, list[str]]] = {}

    # PDF extraction for open-access papers
    pdf_papers = [(p["id"], p["pdf_url"]) for p in papers if p.get("pdf_url")]
    if pdf_papers:
        async with httpx.AsyncClient() as client:
            tasks = [_fetch_and_extract(client, pid, url) for pid, url in pdf_papers]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        for r in results:
            if isinstance(r, Exception):
                log.warning("Extraction task failed: %s", r)
                continue
            paper_id, sections = r
            if any(v for v in sections.values()):
                out[paper_id] = sections

    # Abstract fallback for papers without PDF (or where PDF extraction returned nothing)
    for p in papers:
        pid = p.get("id", "")
        if pid and pid not in out:
            lim = _abstract_limitations(p.get("abstract"))
            if lim:
                out[pid] = {"limitations": lim, "future_work": [], "conclusions": []}

    return out
