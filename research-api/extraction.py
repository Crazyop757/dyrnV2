"""
PyMuPDF-based PDF section extraction.

Fetches open-access PDFs, extracts raw text, and finds limitations,
future-work, and conclusions sections by heading keyword matching.
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


def _is_heading_line(line: str) -> str | None:
    """Check if a line looks like a section heading containing a target keyword.
    Returns the section key or None."""
    stripped = line.strip()
    if not stripped or len(stripped) > 120 or len(stripped) < 4:
        return None
    # Headings are usually short, start with a number or uppercase, and don't end with a period
    if stripped.endswith(".") and not re.match(r"^\d+\.\s", stripped):
        return None
    # Prefer more specific matches first
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


def _find_sections(text: str) -> dict[str, str | None]:
    sections: dict[str, str | None] = {
        "limitations": None,
        "future_work": None,
        "conclusions": None,
    }

    lines = text.split("\n")
    heading_positions: list[tuple[int, str]] = []

    for i, line in enumerate(lines):
        key = _is_heading_line(line)
        if key:
            heading_positions.append((i, key))

    for idx, (line_no, key) in enumerate(heading_positions):
        if sections[key] is not None:
            continue
        start = line_no + 1
        if idx + 1 < len(heading_positions):
            end = heading_positions[idx + 1][0]
        else:
            end = min(start + 200, len(lines))
        body = "\n".join(lines[start:end]).strip()
        if len(body) > 50:
            sections[key] = body[:5000]

    return sections


async def _fetch_and_extract(
    client: httpx.AsyncClient,
    paper_id: str,
    pdf_url: str,
) -> tuple[str, dict[str, str | None]]:
    empty: dict[str, str | None] = {
        "limitations": None,
        "future_work": None,
        "conclusions": None,
    }
    try:
        resp = await client.get(pdf_url, follow_redirects=True, timeout=30.0)
        if resp.status_code != 200:
            log.warning("PDF download failed for %s: %d", paper_id, resp.status_code)
            return paper_id, empty
    except httpx.HTTPError as e:
        log.warning("PDF download error for %s: %s", paper_id, e)
        return paper_id, empty

    if not resp.content[:5].startswith(b"%PDF"):
        log.warning("Response for %s is not a PDF (got %s)", paper_id, resp.headers.get("content-type", "?"))
        return paper_id, empty

    try:
        text = _extract_text_from_pdf(resp.content)
        sections = _find_sections(text)
        return paper_id, sections
    except Exception as e:
        log.warning("PDF parse error for %s: %s", paper_id, e)
        return paper_id, empty


async def extract_sections(
    papers: list[dict[str, Any]],
) -> dict[str, dict[str, str | None]]:
    """Extract limitations/future-work/conclusions for papers with pdf_url.

    Papers without pdf_url are skipped — caller should use abstract fallback.
    """
    tasks = []
    async with httpx.AsyncClient() as client:
        for p in papers:
            pdf_url = p.get("pdf_url")
            if not pdf_url:
                continue
            tasks.append(_fetch_and_extract(client, p["id"], pdf_url))

        if not tasks:
            return {}

        results = await asyncio.gather(*tasks, return_exceptions=True)

    out: dict[str, dict[str, str | None]] = {}
    for r in results:
        if isinstance(r, Exception):
            log.warning("Extraction task failed: %s", r)
            continue
        paper_id, sections = r
        if any(v is not None for v in sections.values()):
            out[paper_id] = sections
    return out
