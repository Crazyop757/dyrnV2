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
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from extraction import extract_sections
from graph import build_graph, classify_intent, compute_gap_signals
from llm import get_llm
from sources.crossref import CrossRef
from sources.openalex import OpenAlex
from sources.pubmed import PubMed
from sources.semantic_scholar import SemanticScholar

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("research-api")

# Patterns indicating a limitation/gap is still open in a citation context
_CITING_LIMIT_RE = re.compile(
    r"\b(does not|doesn't|cannot|can't|fails?\s+to|limited\s+to|unable\s+to|"
    r"lacks?|does not address|doesn't consider|neglects?|ignores?|overlooks?|"
    r"only applies?\s+to|restricted\s+to|not\s+applicable|no\s+prior\s+work|"
    r"remain(?:s)?\s+(?:an?\s+)?open|yet\s+to\s+be|still\s+(?:an?\s+)?open|"
    r"unaddressed|has\s+not\s+been|have\s+not\s+been|was\s+not|were\s+not)\b",
    re.IGNORECASE,
)


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
         contributes something â€” this surfaces complementary coverage that pure
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

    Only Semantic Scholar IDs (no prefix) can seed the graph â€” OpenAlex (OA:),
    CrossRef (DOI:), and PubMed (PMID:) IDs are filtered out because graph
    building uses S2's references/citations endpoints.
    """
    raw_ids = [i.strip() for i in ids.split(",") if i.strip()]
    seed_ids = [i for i in raw_ids if not any(i.startswith(p) for p in ("OA:", "DOI:", "PMID:"))]
    if not seed_ids:
        raise HTTPException(
            status_code=400,
            detail="No Semantic Scholar IDs in the request â€” cannot build a graph.",
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
    pdf_url are skipped â€” the caller should fall back to abstract-only analysis.
    """
    sections = await extract_sections(body.papers)
    return {"sections": sections}


# ---------------------------------------------------------------------------
# Gap analysis helpers
# ---------------------------------------------------------------------------

def _extract_citing_limitations(
    seed_id: str,
    seed_title: str,
    citers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Extract limitation-expressing citation contexts from papers that cite seed_id.

    These are externally-validated gaps: another paper acknowledged seed_id's
    limitation after publication â€” much stronger signal than self-reporting.
    """
    results: list[dict[str, Any]] = []
    for citer in citers:
        for ctx in (citer.get("contexts") or []):
            if _CITING_LIMIT_RE.search(ctx):
                results.append({
                    "quote": ctx[:400],
                    "citing_title": citer.get("title", "(untitled)"),
                    "citing_year": citer.get("year"),
                    "cited_title": seed_title,
                })
    return results


async def _build_egm(
    topic: str,
    papers: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a faceted Evidence Gap Matrix over the fetched papers.

    Step 1: Ask LLM what the 2 most discriminating classification dimensions are.
    Step 2: Classify each paper along those dimensions.
    Step 3: Build a sparse count matrix; empty cells = structural gaps.
    """
    client, llm_model = get_llm()
    if client is None or not papers:
        return {"dim1_label": "", "dim2_label": "", "dim1_values": [], "dim2_values": [], "matrix": [], "empty_cells": []}

    id_to_title = {p.get("id", ""): p.get("title", "") for p in papers}

    # Step 1 â€” infer dimensions
    titles_text = "\n".join(f"- {p.get('title', '')}" for p in papers[:10])
    dim_prompt = f"""Research topic: '{topic}'

Sample paper titles (use these only to understand the research area, NOT as dimension value names):
{titles_text}

Output ONLY valid JSON:
{{
  "dim1_label": "short label (e.g. 'FL Algorithm')",
  "dim1_values": ["val1", "val2", "val3", "val4", "Other"],
  "dim2_label": "short label (e.g. 'Imaging Modality')",
  "dim2_values": ["val1", "val2", "val3", "val4", "Other"]
}}

Rules:
- Choose the 2 most discriminating orthogonal dimensions for classifying papers in this field
- Values must be CANONICAL TECHNIQUE / CATEGORY NAMES from the research community â€” NOT words from paper titles, NOT study types like "Comparative Evaluation" or "Survey"
- Good dim1 example for FL: ["FedAvg", "FedProx", "FedBN", "pFedMe", "SCAFFOLD", "Other"]
- Good dim2 example for medical imaging: ["CT", "MRI", "X-ray", "Ultrasound", "Pathology", "Other"]
- 4-6 mutually exclusive values per dimension, always ending with "Other"
- Values must be short (1-3 words), well-known in the field, and specific enough that many cells will be empty
- NEVER use: study types (comparative, survey, evaluation), vague terms (approach, method, technique), or fragments of paper titles"""

    try:
        r1 = await client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": dim_prompt}],
            response_format={"type": "json_object"},
            max_tokens=400,
            temperature=0,
        )
        dim_data = json.loads(r1.choices[0].message.content or "{}")
    except Exception as e:
        log.warning("EGM dimension inference failed: %s", e)
        return {"dim1_label": "", "dim2_label": "", "dim1_values": [], "dim2_values": [], "matrix": [], "empty_cells": []}

    dim1_label = dim_data.get("dim1_label", "Dimension 1")
    dim2_label = dim_data.get("dim2_label", "Dimension 2")
    dim1_values: list[str] = dim_data.get("dim1_values") or []
    dim2_values: list[str] = dim_data.get("dim2_values") or []
    if not dim1_values or not dim2_values:
        return {"dim1_label": "", "dim2_label": "", "dim1_values": [], "dim2_values": [], "matrix": [], "empty_cells": []}

    # Step 2 â€” classify papers
    paper_blocks = "\n\n".join(
        f"ID: {p.get('id', '')}\nTitle: {p.get('title', '')}\nAbstract: {(p.get('abstract') or p.get('tldr') or '')[:180]}"
        for p in papers[:20]
    )
    cls_prompt = f"""Classify each paper.

Dimension 1 â€” {dim1_label}: {dim1_values}
Dimension 2 â€” {dim2_label}: {dim2_values}

{paper_blocks}

Output ONLY valid JSON:
{{"classifications": [{{"id": "paper_id", "dim1": "exact value from list", "dim2": "exact value from list"}}]}}

Use ONLY values from the lists. Use "Other" if nothing fits."""

    try:
        r2 = await client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": cls_prompt}],
            response_format={"type": "json_object"},
            max_tokens=800,
            temperature=0,
        )
        cls_data = json.loads(r2.choices[0].message.content or "{}")
        classifications: list[dict[str, Any]] = cls_data.get("classifications") or []
    except Exception as e:
        log.warning("EGM classification failed: %s", e)
        return {"dim1_label": dim1_label, "dim2_label": dim2_label, "dim1_values": dim1_values, "dim2_values": dim2_values, "matrix": [], "empty_cells": []}

    # Step 3 â€” build matrix
    matrix_counts: dict[str, dict[str, list[str]]] = {}
    for cls in classifications:
        d1 = cls.get("dim1", "Other")
        d2 = cls.get("dim2", "Other")
        pid = cls.get("id", "")
        matrix_counts.setdefault(d1, {}).setdefault(d2, []).append(pid)

    # Build rows (exclude OtherÃ—Other noise)
    matrix_rows: list[dict[str, Any]] = []
    empty_cells: list[dict[str, Any]] = []
    for d1 in dim1_values:
        if d1 == "Other":
            continue
        cells = []
        for d2 in dim2_values:
            if d2 == "Other":
                continue
            pids = (matrix_counts.get(d1) or {}).get(d2) or []
            count = len(pids)
            cells.append({
                "dim2_value": d2,
                "count": count,
                "paper_titles": [id_to_title.get(pid, "") for pid in pids[:2]],
            })
            if count == 0:
                empty_cells.append({
                    "dim1_value": d1,
                    "dim2_value": d2,
                    "count": 0,
                    "gap_statement": f"No studies combining {d1} with {d2}",
                })
            elif count == 1:
                titles = [id_to_title.get(pid, "") for pid in pids]
                empty_cells.append({
                    "dim1_value": d1,
                    "dim2_value": d2,
                    "count": 1,
                    "gap_statement": f"Only 1 study: {titles[0][:60] if titles else ''}",
                })
        matrix_rows.append({"dim1_value": d1, "cells": cells})

    return {
        "dim1_label": dim1_label,
        "dim2_label": dim2_label,
        "dim1_values": [v for v in dim1_values if v != "Other"],
        "dim2_values": [v for v in dim2_values if v != "Other"],
        "matrix": matrix_rows,
        "empty_cells": empty_cells[:12],
    }


async def _induce_gaps(
    topic: str,
    papers: list[dict[str, Any]],
    sections: dict[str, dict],
    signals: dict,
    citing_limits: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Call the active LLM provider (OpenAI or Groq) to induce research gaps as structured JSON."""
    client, llm_model = get_llm()
    if client is None:
        return []

    # Build citing-paper evidence block (primary evidence â€” external validation)
    citing_blocks: list[str] = []
    for cl in (citing_limits or [])[:15]:
        citing_blocks.append(
            f'[{cl.get("citing_title", "?")} ({cl.get("citing_year", "?")})] '
            f'cites [{cl.get("cited_title", "?")}] and says: "{cl.get("quote", "")}"'
        )
    citing_text = "\n".join(citing_blocks) if citing_blocks else "None available."

    # Build paper context blocks
    paper_blocks: list[str] = []
    for p in papers[:15]:
        pid = p.get("id", "")
        lines = [f"### {p.get('title', '(untitled)')} ({p.get('year', 'n/a')})"]
        lines.append(
            f"Authors: {', '.join((p.get('authors') or [])[:3]) or 'unknown'} | "
            f"Citations: {p.get('citation_count', 0)}"
        )
        if p.get("tldr"):
            lines.append(f"TLDR: {p['tldr']}")
        elif p.get("abstract"):
            lines.append(f"Abstract: {(p.get('abstract') or '')[:250]}â€¦")

        paper_secs = sections.get(pid, {})
        lim_quotes = paper_secs.get("limitations") or []
        if lim_quotes:
            lines.append("Stated limitations:")
            for q in lim_quotes[:3]:
                lines.append(f'  - "{q}"')
        fw_quotes = paper_secs.get("future_work") or []
        if fw_quotes:
            lines.append("Future work directions:")
            for q in fw_quotes[:2]:
                lines.append(f'  - "{q}"')
        paper_blocks.append("\n".join(lines))

    # Build graph signal context
    signal_lines: list[str] = []
    for ws in signals.get("white_space", []):
        signal_lines.append(
            f"CLUSTER GAP: '{ws['cluster_a']}' and '{ws['cluster_b']}' are semantically "
            f"similar (cosine {ws['similarity']}) but have only {ws['citation_count']} "
            f"cross-citations â€” a likely unexplored interdisciplinary connection."
        )
    for c in signals.get("contradictions", []):
        signal_lines.append(
            f"CONTRADICTION: \"{c['source_title']}\" contradicts \"{c['target_title']}\": "
            f"\"{c['context'][:200]}\""
        )
    for b in signals.get("bridges", []):
        signal_lines.append(
            f"FRAGILE BRIDGE: \"{b['title']}\" ({b.get('year', 'n/a')}) is a key bridge "
            f"(betweenness {b['betweenness']}) but has only {b['citation_count']} citations."
        )

    papers_text = "\n\n".join(paper_blocks) if paper_blocks else "No papers provided."
    signals_text = "\n".join(signal_lines) if signal_lines else "No graph signals available."

    system_prompt = f"""You are a research-gap analyst. Analyse evidence about '{topic}' and identify genuine, specific research gaps.

## PRIMARY EVIDENCE â€” Citing-paper external limitations (strongest signal)
These are quotes from papers that CITE our seed papers and explicitly say something is still missing.
This is external validation: another author confirmed the limitation was still open after the seed paper was published.
{citing_text}

## SECONDARY EVIDENCE â€” Self-reported limitations / future-work
{papers_text}

## Graph signals (structural gaps from citation network)
{signals_text}

## Output format

Output ONLY valid JSON â€” nothing else. Use this exact schema:
{{
  "gaps": [
    {{
      "statement": "Clear 1-2 sentence gap statement naming the missing variable, method, or population.",
      "type": "methodological|knowledge|empirical|population|theoretical|evidence_contradictory|practical",
      "impact": "One sentence: why closing this gap matters â€” the concrete consequence of leaving it open.",
      "recommendation": "One sentence: a concrete next study to address it â€” name a design, population, method, and outcome measure.",
      "grounding": [
        {{
          "paper_title": "exact title from papers listed above",
          "year": 2023,
          "quote": "verbatim sentence from the limitations or future_work listed above",
          "section": "limitations|future_work|abstract|citing_paper"
        }}
      ],
      "graph_signal": null,
      "verification_queries": ["narrow query 1", "narrow query 2", "narrow query 3"]
    }}
  ]
}}

Rules:
1. Every gap MUST have grounding: prefer citing-paper evidence (use section='citing_paper') over self-reported. If from citing evidence, paper_title = the CITING paper title. Alternatively use a non-null graph_signal.
2. For graph-signal gaps, set grounding to [] and set graph_signal to {{"type": "white_space|contradiction|bridge", "description": "one sentence"}}.
3. verification_queries: 3 SPECIFIC, NARROW sub-queries â€” name a precise method, population, or condition. Bad: "transformer attention mechanisms in stock price prediction". Good: "transformer cross-attention intraday volatility prediction without technical indicators".
4. Do NOT invent gaps unsupported by the evidence above.
5. Output 4-8 gaps. type must be exactly one of the 7 listed values.
6. CRITICAL â€” gaps must be narrow: a good gap has fewer than 10 papers addressing it. State a specific combination of method + population + outcome, not a broad sub-field. If you can only find broad gaps, say so by outputting fewer gaps.
7. BANNED phrasing â€” never write vague filler like "more research is needed", "further studies should explore", or "this area is understudied". Every statement, impact, and recommendation must name the specific missing variable / method / population / outcome.
8. impact and recommendation are REQUIRED on every gap. The recommendation must be a concrete, runnable study, not a topic."""

    try:
        resp = await client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": system_prompt}],
            response_format={"type": "json_object"},
            max_tokens=3500,
            temperature=0.3,
        )
        content = resp.choices[0].message.content or "{}"
        data = json.loads(content)
        gaps = data.get("gaps") or []
        for i, gap in enumerate(gaps):
            gap["id"] = f"gap-{i + 1}"
        return gaps
    except Exception as e:
        log.warning("Gap induction failed: %s", e)
        return []


async def _verify_gaps(
    gaps: list[dict[str, Any]],
    s2: "SemanticScholar",
    oa: "OpenAlex",
) -> list[dict[str, Any]]:
    """Multi-query, multi-index verification with relevance filtering."""

    async def verify_one(gap: dict[str, Any]) -> dict[str, Any]:
        queries = gap.get("verification_queries") or []
        if not queries:
            gap["verification"] = {
                "confidence": "unverified",
                "relevant_count": 0,
                "queries_used": [],
                "indices_searched": [],
                "sample_papers": [],
                "status": "no_queries",
            }
            return gap

        all_results: list[dict[str, Any]] = []
        queries_used: list[str] = []
        indices_searched: set[str] = set()
        any_search_ok = False

        for q in queries[:3]:
            results, ok = await s2.search_papers_safe(q, limit=30)
            if ok:
                any_search_ok = True
                indices_searched.add("semantic_scholar")
            all_results.extend(results)
            queries_used.append(q)

        for q in queries[:2]:
            try:
                oa_res = await oa.search_papers(q, limit=20)
                if oa_res:
                    indices_searched.add("openalex")
                    all_results.extend(oa_res)
            except Exception:
                pass

        if not any_search_ok and not all_results:
            gap["verification"] = {
                "confidence": "error",
                "relevant_count": 0,
                "queries_used": queries_used,
                "indices_searched": sorted(indices_searched),
                "sample_papers": [],
                "status": "search_failed",
            }
            return gap

        # Relevance filter: title/abstract must overlap with gap keywords
        gap_kw = {
            w.lower() for w in re.split(r"\W+", gap.get("statement", ""))
            if len(w) > 4
        }

        seen_titles: set[str] = set()
        relevant: list[dict[str, Any]] = []
        for r in all_results:
            title_raw = r.get("title") or ""
            title_key = re.sub(r"\W+", "", title_raw.lower())[:60]
            if title_key in seen_titles:
                continue
            seen_titles.add(title_key)

            text = (title_raw + " " + (r.get("abstract") or "")).lower()
            overlap = sum(1 for kw in gap_kw if kw in text)
            if overlap >= 2:
                relevant.append(r)

        n = len(relevant)
        if n == 0 and any_search_ok:
            confidence = "incoherent"
        elif n <= 3:
            confidence = "confirmed"
        elif n <= 15:
            confidence = "partial"
        else:
            confidence = "unlikely"

        gap["verification"] = {
            "confidence": confidence,
            "relevant_count": n,
            "queries_used": queries_used,
            "indices_searched": sorted(indices_searched),
            "sample_papers": [
                {"title": r.get("title", ""), "year": r.get("year"), "url": r.get("url")}
                for r in relevant[:3]
            ],
            "status": "ok",
        }
        return gap

    results = await asyncio.gather(*[verify_one(g) for g in gaps], return_exceptions=True)
    out: list[dict[str, Any]] = []
    for r in results:
        if isinstance(r, BaseException):
            log.warning("Gap verification error: %s", r)
        elif r is not None:
            out.append(r)
    return out


def _build_gap_map(gaps: list[dict[str, Any]], signals: dict) -> dict:
    """Build cluster-pair gap map for the frontend visual."""
    cluster_pairs = []
    for ws in signals.get("white_space", []):
        gap_count = sum(
            1 for g in gaps
            if (g.get("graph_signal") or {}).get("type") == "white_space"
        )
        cluster_pairs.append({
            "cluster_a": ws["cluster_a"],
            "cluster_b": ws["cluster_b"],
            "similarity": ws["similarity"],
            "citation_count": ws["citation_count"],
            "gap_count": gap_count,
        })
    return {"cluster_pairs": cluster_pairs}


class GapAnalysisRequest(BaseModel):
    topic: str
    papers: list[dict[str, Any]]
    seed_ids: list[str] = []


@app.post("/gaps")
async def gap_analysis_endpoint(body: GapAnalysisRequest) -> dict[str, Any]:
    """Full server-side gap analysis pipeline.

    1. Extract author-stated limitations/future-work (PDF + abstract fallback).
    2. Compute graph signals (white-space between clusters, contradiction edges, bridges).
    3. LLM gap induction seeded by 1+2 â€” structured JSON, grounded output.
    4. Multi-query multi-index verification with SPECTER2-guided relevance filtering.
    Returns {gaps: [...], gap_map: {...}}.
    """
    topic = body.topic
    papers = body.papers
    # Only S2 IDs can seed the graph
    seed_ids = [
        i for i in body.seed_ids
        if not any(i.startswith(p) for p in ("OA:", "DOI:", "PMID:"))
    ][:20]

    # 1. Extract sections
    sections = await extract_sections(papers)

    # 2. Graph signals
    signals: dict[str, Any] = {"white_space": [], "bridges": [], "contradictions": []}
    if seed_ids:
        try:
            meta = await app.state.s2.get_papers_batch(seed_ids)
            valid_ids = list(meta.keys())

            raw_embeddings: list[list[float]] = []
            embed_ids: list[str] = []
            for sid in valid_ids:
                emb = meta[sid].get("specter_v2") or []
                if emb:
                    raw_embeddings.append(emb)
                    embed_ids.append(sid)

            # K-Means cluster assignment with centroid-representative naming
            clusters_map: dict[str, str] = {}
            if len(raw_embeddings) >= 3:
                import numpy as np
                from sklearn.cluster import KMeans
                _STOP = {"a","an","the","of","in","on","for","and","with","to","using","via","by","from"}
                n_clusters = min(4, len(raw_embeddings))
                X = np.array(raw_embeddings)
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10).fit(X)
                cluster_members: dict[int, list[str]] = {}
                for i, sid in enumerate(embed_ids):
                    cluster_members.setdefault(int(kmeans.labels_[i]), []).append(sid)
                label_names: dict[int, str] = {}
                for lbl, members in cluster_members.items():
                    centroid = kmeans.cluster_centers_[lbl]
                    best = min(members, key=lambda s: float(np.linalg.norm(
                        np.array(meta[s].get("specter_v2") or centroid) - centroid
                    )))
                    title = meta[best].get("title") or ""
                    words = [w for w in title.split() if w.lower() not in _STOP and len(w) > 2]
                    label_names[lbl] = " ".join(words[:4]) if words else f"Cluster {lbl+1}"
                for i, sid in enumerate(embed_ids):
                    clusters_map[sid] = label_names[int(kmeans.labels_[i])]
            for sid in valid_ids:
                clusters_map.setdefault(sid, "Research Cluster")

            # Fetch citation contexts for top-5 seeds
            citation_edges: list[dict[str, Any]] = []
            for sid in valid_ids[:5]:
                try:
                    ctx = await app.state.s2.get_references_with_context(sid, limit=50)
                    for ref_id, cdata in ctx.items():
                        if ref_id not in valid_ids:
                            continue
                        intents = cdata.get("intents") or []
                        contexts = cdata.get("contexts") or []
                        intent = "General Reference"
                        if "methodology" in intents:
                            intent = "Applies Method"
                        elif "result" in intents:
                            intent = "Builds Upon"
                        elif contexts:
                            intent = await classify_intent(contexts[0])
                        citation_edges.append({
                            "source": ref_id,
                            "target": sid,
                            "weight": 0.8,
                            "intent": intent,
                            "context": contexts[0] if contexts else "",
                        })
                except Exception:
                    pass

            signals = compute_gap_signals(
                valid_ids=valid_ids,
                meta=meta,
                embeddings=raw_embeddings,
                embed_ids=embed_ids,
                clusters_map=clusters_map,
                edges=citation_edges,
            )
        except Exception as e:
            log.warning("Gap signal computation failed: %s", e)

    # 3. Fetch citing-paper contexts for top-3 seeds (external gap evidence)
    citing_limits: list[dict[str, Any]] = []
    for sid in seed_ids[:3]:
        try:
            citers = await app.state.s2.get_citations_with_context(sid, limit=30)
            seed_title = next((p.get("title", "") for p in papers if p.get("id") == sid), "")
            citing_limits.extend(_extract_citing_limitations(sid, seed_title, citers))
        except Exception as e:
            log.warning("Citing context fetch failed for %s: %s", sid, e)

    # 4. Run LLM gap induction + EGM in parallel
    raw_gaps, egm = await asyncio.gather(
        _induce_gaps(topic, papers, sections, signals, citing_limits),
        _build_egm(topic, papers),
    )

    # 4b. Synthesise EGM-derived gaps (pre-verified: count=0 â†’ confirmed, count=1 â†’ partial)
    egm_gaps: list[dict[str, Any]] = []
    for i, cell in enumerate((egm.get("empty_cells") or [])[:5]):
        confidence = "confirmed" if cell["count"] == 0 else "partial"
        d1, d2 = cell["dim1_value"], cell["dim2_value"]
        if cell["count"] == 0:
            impact = f"The {egm.get('dim1_label', 'first')} Ã— {egm.get('dim2_label', 'second')} combination of {d1} and {d2} is untested, so its effectiveness is currently unknown."
            recommendation = f"Run an empirical study applying {d1} to {d2} and report standard outcome metrics to fill this matrix cell."
        else:
            impact = f"A single study on {d1} Ã— {d2} means the finding is unreplicated and its generality is unconfirmed."
            recommendation = f"Replicate the existing {d1} Ã— {d2} work on a new dataset or population to test robustness."
        egm_gaps.append({
            "id": f"egm-{i + 1}",
            "statement": cell["gap_statement"],
            "type": "empirical",
            "impact": impact,
            "recommendation": recommendation,
            "grounding": [],
            "graph_signal": None,
            "egm_cell": {"dim1": cell["dim1_value"], "dim2": cell["dim2_value"], "count": cell["count"]},
            "verification_queries": [],
            "verification": {
                "confidence": confidence,
                "relevant_count": cell["count"],
                "queries_used": [],
                "indices_searched": ["egm_matrix"],
                "sample_papers": [],
                "status": "egm_derived",
            },
        })

    if not raw_gaps and not egm_gaps:
        return {"gaps": [], "gap_map": {"cluster_pairs": []}, "egm": egm}

    # 5. Verify only the LLM-induced gaps (EGM gaps are already verified)
    verified_llm_gaps = await _verify_gaps(raw_gaps, app.state.s2, app.state.oa)

    # 6. Merge and sort: EGM confirmed gaps first, then LLM gaps by confidence
    all_gaps = egm_gaps + verified_llm_gaps
    _CONF_ORDER = {"confirmed": 0, "partial": 1, "unlikely": 2, "incoherent": 3, "error": 4, "unverified": 5}
    all_gaps.sort(key=lambda g: (
        _CONF_ORDER.get((g.get("verification") or {}).get("confidence", "unverified"), 5),
        (g.get("verification") or {}).get("relevant_count", 0),
    ))

    # Re-number IDs after sort
    for i, g in enumerate(all_gaps):
        if not g["id"].startswith("egm-"):
            g["id"] = f"gap-{i + 1}"

    # If ALL non-EGM gaps are unlikely, flag them
    non_egm = [g for g in all_gaps if not g["id"].startswith("egm-")]
    if non_egm and all((g.get("verification") or {}).get("confidence") == "unlikely" for g in non_egm):
        for g in non_egm:
            g.setdefault("verification", {})["status"] = "saturated_area"
        all_gaps = egm_gaps + non_egm[:3]

    # 7. Gap map and return
    gap_map = _build_gap_map(all_gaps, signals)
    return {"gaps": all_gaps, "gap_map": gap_map, "egm": egm}


# ---------------------------------------------------------------------------
# Per-paper summarization
# ---------------------------------------------------------------------------

class SummarizeRequest(BaseModel):
    paper: dict[str, Any]


_SUMMARY_KEYS = ("tldr", "objective", "methods", "key_findings", "limitations", "contribution")


@app.post("/summarize-paper")
async def summarize_paper(body: SummarizeRequest) -> dict[str, Any]:
    """Produce a structured, grounded summary of a single paper.

    We usually only have the abstract (full text is rarely open-access), so the
    prompt hard-constrains the model to the provided text and forces the literal
    placeholder "Not stated in abstract" for any field it cannot ground â€” this is
    the single biggest guard against the model filling methods/results from memory.
    """
    client, llm_model = get_llm()
    if client is None:
        raise HTTPException(status_code=503, detail="No LLM provider configured.")

    p = body.paper
    title = (p.get("title") or "").strip()
    abstract = (p.get("abstract") or p.get("tldr") or "").strip()
    authors = ", ".join((p.get("authors") or [])[:6]) or "unknown"
    year = p.get("year") or "n/a"
    venue = p.get("venue") or "n/a"

    if not abstract:
        # Nothing to ground a summary in â€” be honest rather than hallucinate.
        return {
            "summary": {
                "tldr": "No abstract is available for this paper, so it cannot be summarized.",
                "objective": "Not stated in abstract",
                "methods": "Not stated in abstract",
                "key_findings": "Not stated in abstract",
                "limitations": "Not stated in abstract",
                "contribution": "Not stated in abstract",
            },
            "grounded_on": "none",
        }

    prompt = f"""You are summarizing a single academic paper for a researcher. You are given ONLY its title, abstract, and metadata.

CONSTRAINTS:
- Use ONLY the provided text. Do NOT invent methods, numbers, datasets, or results not explicitly stated.
- If a field cannot be determined from the abstract, output exactly: "Not stated in abstract".
- Be specific: prefer the paper's own quantities and terms over generic phrasing.
- Objective academic tone. No hype, no first person, no commentary outside the fields.

PAPER:
Title: {title}
Authors: {authors} ({year}), {venue}
Abstract: {abstract}

Output ONLY valid JSON with this exact schema:
{{
  "tldr": "one sentence, <=30 words: the objective plus the headline result",
  "objective": "the research question or goal",
  "methods": "design, data, sample size, model/approach â€” or 'Not stated in abstract'",
  "key_findings": "the actual results, quantified where stated",
  "limitations": "stated limitations â€” usually 'Not stated in abstract' for abstract-only input",
  "contribution": "why it matters / what it adds to the field"
}}"""

    try:
        resp = await client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=700,
            temperature=0.2,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:
        log.warning("Paper summarization failed: %s", e)
        raise HTTPException(status_code=502, detail="Summarization failed.")

    summary = {k: (str(data.get(k) or "").strip() or "Not stated in abstract") for k in _SUMMARY_KEYS}
    return {"summary": summary, "grounded_on": "abstract"}

# ---------------------------------------------------------------------------
# Literature review generation
# ---------------------------------------------------------------------------

_AUTHOR_SURNAME_RE = re.compile(r"[^A-Za-z\u00C0-\u024F\- ]+")


def _surname(name: str) -> str:
    """Best-effort surname extraction from a free-form author name.

    Returns "" for names we can't parse (e.g. non-Latin scripts the citekey
    regex strips entirely); callers fall back to the full name or "Anon".
    """
    # Handle "Last, First" â€” surname is the comma-prefix.
    if "," in (name or ""):
        head = (name.split(",")[0]).strip().split()
        if head:
            return head[-1]
    parts = _AUTHOR_SURNAME_RE.sub("", (name or "").strip()).split()
    return parts[-1] if parts else ""


def _citekey(p: dict[str, Any]) -> str:
    authors = p.get("authors") or []
    surname = _surname(authors[0]) if authors else "Anon"
    year = p.get("year") or "n.d."
    return f"{surname or 'Anon'}{year}"


def _citation_label(p: dict[str, Any]) -> str:
    """A human-facing in-text label like 'Smith et al., 2020'."""
    authors = p.get("authors") or []
    year = p.get("year") or "n.d."
    if not authors:
        return f"Anon., {year}"
    first = _surname(authors[0]) or authors[0]
    if len(authors) == 1:
        return f"{first}, {year}"
    if len(authors) == 2:
        return f"{first} & {_surname(authors[1]) or authors[1]}, {year}"
    return f"{first} et al., {year}"


def _reference_line(p: dict[str, Any]) -> str:
    authors = p.get("authors") or []
    if len(authors) > 6:
        author_str = ", ".join(authors[:6]) + ", et al."
    else:
        author_str = ", ".join(authors) or "Anon."
    year = p.get("year") or "n.d."
    title = (p.get("title") or "Untitled").strip().rstrip(".")
    venue = p.get("venue")
    link = p.get("doi") and f"https://doi.org/{p['doi']}" or p.get("url") or p.get("pdf_url")
    ref = f"{author_str} ({year}). {title}."
    if venue:
        ref += f" *{venue}*."
    if link:
        ref += f" [{link}]({link})"
    return ref


def _humanize_citekeys(text: str, entry_map: dict[str, dict[str, Any]]) -> str:
    """Replace any raw citekeys the model leaked (e.g. 'Wang2020' or '[Vaswani2017]')
    with the human in-text label ('Wang & Li, 2020'). The model is asked to use the
    labels directly but occasionally falls back to the bracket key â€” this keeps the
    rendered review consistent. Longest keys first so 'Wang2020a' isn't half-matched."""
    if not text:
        return text
    for key in sorted(entry_map, key=len, reverse=True):
        label = entry_map[key]["citation_label"]
        # Bracketed form -> parenthesised label; bare token -> label.
        text = re.sub(rf"\[\s*{re.escape(key)}\s*\]", f"({label})", text)
        text = re.sub(rf"(?<![\w]){re.escape(key)}(?![\w])", label, text)
    return text


async def _extract_themes(
    topic: str,
    entries: list[dict[str, Any]],
) -> dict[str, Any]:
    """Stage A: cluster papers into 3-6 organizing themes (theme-first synthesis)."""
    client, llm_model = get_llm()
    if client is None:
        return {"themes": [], "debates": [], "gaps": []}

    blocks = "\n\n".join(
        f"[{e['citekey']}] {e['title']} ({e.get('year', 'n/a')})\n{(e.get('abstract') or '')[:300]}"
        for e in entries
    )
    valid_keys = [e["citekey"] for e in entries]

    prompt = f"""Research topic: '{topic}'

You are organizing a literature review. Below are {len(entries)} papers, each tagged with a citekey in [brackets].

{blocks}

Identify 3-6 THEMES that organize this literature (by research question, method family, or debate â€” NOT one theme per paper). For each theme, list which papers belong to it (a paper may appear in several themes). Also surface explicit debates (papers that disagree) and apparent gaps.

Output ONLY valid JSON:
{{
  "themes": [
    {{"theme": "short theme title", "description": "1 sentence on what this theme covers", "citekeys": ["{valid_keys[0] if valid_keys else 'Key2020'}", "..."]}}
  ],
  "debates": ["1 sentence naming a specific disagreement and the papers involved"],
  "gaps": ["1 sentence naming a specific under-explored area"]
}}

Rules:
- Use ONLY citekeys from the list above; never invent one.
- 3-6 themes. Every theme needs >=1 citekey. Order themes from foundational to emerging."""

    try:
        resp = await client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=1200,
            temperature=0.2,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:
        log.warning("Theme extraction failed: %s", e)
        return {"themes": [], "debates": [], "gaps": []}

    valid = set(valid_keys)
    themes = []
    for t in data.get("themes") or []:
        keys = [k for k in (t.get("citekeys") or []) if k in valid]
        if keys and t.get("theme"):
            themes.append({"theme": t["theme"], "description": t.get("description", ""), "citekeys": keys})
    return {
        "themes": themes,
        "debates": [d for d in (data.get("debates") or []) if d][:4],
        "gaps": [g for g in (data.get("gaps") or []) if g][:4],
    }


async def _synthesize_theme(
    topic: str,
    theme: dict[str, Any],
    entry_map: dict[str, dict[str, Any]],
) -> str:
    """Stage B: write ONE synthesized paragraph for a single theme."""
    client, llm_model = get_llm()
    if client is None:
        return ""

    papers_text = "\n\n".join(
        f"[{k}] {entry_map[k]['title']} ({entry_map[k].get('year', 'n/a')})\n{(entry_map[k].get('abstract') or '')[:350]}"
        for k in theme["citekeys"] if k in entry_map
    )
    label_map = {k: entry_map[k]["citation_label"] for k in theme["citekeys"] if k in entry_map}

    prompt = f"""Write ONE synthesis paragraph for the literature-review theme "{theme['theme']}" (topic: '{topic}').

Papers for this theme (cite using the label shown after each citekey):
{papers_text}

In-text citation labels to use:
{json.dumps(label_map)}

RULES:
- Open with a theme-level topic sentence, NOT an author name.
- SYNTHESIZE â€” do not summarize papers one at a time. Group and contrast them; use relationship language (agree, extend, build on, contradict).
- Every claim is followed by an in-text citation using the labels above, e.g. (Smith, 2020) or grouped (Smith, 2020; Lee, 2021).
- Note any disagreement or what remains unresolved within this theme.
- 120-180 words. Academic prose. No headings, no bullet points, no preamble â€” output only the paragraph."""

    try:
        resp = await client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.3,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as e:
        log.warning("Theme synthesis failed for %r: %s", theme.get("theme"), e)
        return ""


class LiteratureReviewRequest(BaseModel):
    topic: str
    papers: list[dict[str, Any]]


@app.post("/literature-review")
async def literature_review(body: LiteratureReviewRequest) -> dict[str, Any]:
    """Generate a synthesized, theme-organized literature review draft with citations.

    Two-stage pipeline (the key to synthesis rather than paper-by-paper summary):
      A. Extract 3-6 organizing themes across all papers.
      B. Write one synthesized paragraph PER theme in parallel, each citing only
         its own papers via Python-computed citekeys (so citations can't be
         hallucinated). References are assembled deterministically.
    """
    client, _ = get_llm()
    if client is None:
        raise HTTPException(status_code=503, detail="No LLM provider configured.")

    papers = [p for p in body.papers if (p.get("abstract") or p.get("tldr") or p.get("title"))][:24]
    if len(papers) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 papers to write a literature review.")

    # Build entries with unique citekeys (disambiguate collisions with a/b/c suffix).
    entries: list[dict[str, Any]] = []
    used: dict[str, int] = {}
    for p in papers:
        base = _citekey(p)
        n = used.get(base, 0)
        used[base] = n + 1
        key = base if n == 0 else f"{base}{chr(ord('a') + n)}"
        entries.append({
            "citekey": key,
            "title": p.get("title") or "Untitled",
            "abstract": p.get("abstract") or p.get("tldr") or "",
            "year": p.get("year"),
            "citation_label": _citation_label(p),
            "paper": p,
        })
    entry_map = {e["citekey"]: e for e in entries}

    plan = await _extract_themes(body.topic, entries)
    themes = plan["themes"]
    if not themes:
        raise HTTPException(status_code=502, detail="Could not derive themes for a literature review.")

    paragraphs = await asyncio.gather(
        *[_synthesize_theme(body.topic, t, entry_map) for t in themes]
    )

    # Assemble markdown: intro -> per-theme sections -> debates -> gaps -> references.
    cited_keys: set[str] = set()
    parts: list[str] = [f"# Literature Review: {body.topic}\n"]
    n_papers = len(entries)
    n_themes = len(themes)
    parts.append(
        f"This review synthesizes {n_papers} works across {n_themes} themes, "
        "organized thematically rather than paper-by-paper.\n"
    )

    for t, para in zip(themes, paragraphs):
        parts.append(f"## {t['theme']}\n")
        if para:
            parts.append(_humanize_citekeys(para, entry_map) + "\n")
        else:
            parts.append(t.get("description", "") + "\n")
        cited_keys.update(t["citekeys"])

    if plan["debates"]:
        parts.append("## Tensions & debates\n")
        parts.append("\n".join(f"- {_humanize_citekeys(d, entry_map)}" for d in plan["debates"]) + "\n")

    if plan["gaps"]:
        parts.append("## Gaps & future directions\n")
        parts.append("\n".join(f"- {_humanize_citekeys(g, entry_map)}" for g in plan["gaps"]) + "\n")

    parts.append("## References\n")
    ref_lines = []
    for e in entries:
        if e["citekey"] in cited_keys:
            ref_lines.append(f"- {_reference_line(e['paper'])}")
    # Fall back to listing all papers if the model cited nothing parseable.
    if not ref_lines:
        ref_lines = [f"- {_reference_line(e['paper'])}" for e in entries]
    parts.append("\n".join(ref_lines) + "\n")

    markdown = "\n".join(parts)
    return {
        "markdown": markdown,
        "themes": [{"theme": t["theme"], "description": t["description"], "paper_count": len(t["citekeys"])} for t in themes],
        "debates": plan["debates"],
        "gaps": plan["gaps"],
        "paper_count": n_papers,
    }


@app.get("/verify-gap")
async def verify_gap(
    query: str = Query(..., min_length=2),
) -> dict[str, Any]:
    """Verify a gap query with error-safe S2 search.

    Uses search_papers_safe so API failures are never misread as 'confirmed gap'.
    """
    results, ok = await app.state.s2.search_papers_safe(query, limit=50)

    if not ok:
        return {
            "query": query,
            "total": 0,
            "confidence": "error",
            "status": "search_failed",
            "papers": [],
        }

    total = len(results)
    if total == 0:
        confidence = "incoherent"  # genuine zero â€” query may be nonsense
    elif total <= 3:
        confidence = "confirmed"
    elif total <= 15:
        confidence = "partial"
    else:
        confidence = "unlikely"

    return {
        "query": query,
        "total": total,
        "confidence": confidence,
        "status": "ok",
        "papers": [
            {"title": r["title"], "year": r.get("year"), "url": r.get("url")}
            for r in results[:3]
        ],
    }


# ---------------------------------------------------------------------------
# Variable-Extraction Matrix
# ---------------------------------------------------------------------------

class ExtractMatrixRequest(BaseModel):
    papers: list[dict[str, Any]]
    columns: list[str]

async def _extract_matrix_for_paper(
    paper: dict[str, Any],
    columns: list[str],
    paper_sections: dict[str, list[str]]
) -> tuple[str, dict[str, Any]]:
    client, llm_model = get_llm()
    pid = paper.get("id", "")
    title = paper.get("title", "")
    
    default_cols = {
        c: {
            "extracted_value": None,
            "source_passage": None,
            "source_section": None,
            "confidence": 0.0,
            "pdf_page": None
        }
        for c in columns
    }
    
    if not client:
        return pid, {"title": title, "columns": default_cols}
        
    abstract = paper.get("abstract") or paper.get("tldr") or ""
    has_pdf = bool(paper.get("pdf_url"))
    
    text_blocks = []
    if abstract:
        text_blocks.append(f"Abstract:\n{abstract}")
        
    for sec_name, sentences in paper_sections.items():
        if sentences:
            text_blocks.append(f"Section {sec_name.upper()}:\n" + "\n".join(sentences))
            
    full_text = "\n\n".join(text_blocks) if text_blocks else "No text available."
    cols_json = json.dumps(columns)
    
    system_prompt = f"""You are a research data extraction assistant.
Extract the requested variables from the provided paper text.

Columns to extract: {cols_json}

Available text for paper '{title}':
{full_text}

Output ONLY valid JSON matching this schema:
{{
  "columns": {{
    "column_name": {{
      "extracted_value": "The specific value or short summary (or null if not found)",
      "source_passage": "The verbatim sentence containing the value (or null)",
      "source_section": "The section name where it was found (e.g. 'Abstract', 'Limitations') (or null)",
      "confidence": 0.85,
      "pdf_page": 2
    }}
  }}
}}

Rules:
1. If the paper has no PDF text (has_pdf={has_pdf}), you are falling back to abstract-only extraction. In this case, YOU MUST set pdf_page to null.
2. If the value is not found in the provided text, set extracted_value to null and confidence to 0.0.
3. If found, estimate pdf_page if possible, or set to null.
"""

    try:
        resp = await client.chat.completions.create(
            model=llm_model,
            messages=[{"role": "user", "content": system_prompt}],
            response_format={"type": "json_object"},
            max_tokens=2500,
            temperature=0.0,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        columns_data = data.get("columns", {})
        
        res_cols = {}
        for c in columns:
            res_cols[c] = columns_data.get(c, default_cols[c])
            
        return pid, {"title": title, "columns": res_cols}
    except Exception as e:
        log.warning("Matrix extraction failed for %s: %s", pid, e)
        return pid, {"title": title, "columns": default_cols}


@app.post("/extract-matrix")
async def extract_matrix_endpoint(body: ExtractMatrixRequest) -> dict[str, Any]:
    """Dynamic Variable-Extraction Matrix."""
    papers = body.papers
    columns = body.columns
    
    # 1. Reuse existing GROBID-based PDF extraction pipeline used in /gaps
    sections = await extract_sections(papers)
    
    # 2. Process all papers concurrently using asyncio
    tasks = []
    for p in papers:
        pid = p.get("id", "")
        p_sections = sections.get(pid, {})
        tasks.append(_extract_matrix_for_paper(p, columns, p_sections))
        
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    matrix = {}
    for r in results:
        if isinstance(r, BaseException):
            log.warning("Task failed in extract_matrix_endpoint: %s", r)
            continue
        pid, data = r
        if pid:
            matrix[pid] = data
            
    return {"matrix": matrix}


class CoverageRequest(BaseModel):
    paper_ids: list[str]

@app.post("/coverage")
async def coverage_endpoint(request: Request, body: CoverageRequest) -> dict[str, Any]:
    """Saturation Engine: Computes coverage saturation score for a set of papers."""
    paper_ids = body.paper_ids
    if not paper_ids:
        return {"error": "No paper IDs provided"}

    s2: SemanticScholar = request.app.state.s2
    if not s2:
        return {"error": "Semantic Scholar API not available"}

    # 1. Fetch 1-hop citation neighborhood
    links1 = await s2.get_links_batch(paper_ids)
    hop1_ids = set(paper_ids)
    for pid, (refs, citers) in links1.items():
        hop1_ids.update(refs.keys())
        hop1_ids.update(citers.keys())

    # 2. Fetch 2-hop citation neighborhood (capped expansion)
    max_hop1_to_expand = 800
    expand_nodes = list(hop1_ids)[:max_hop1_to_expand]
    links2 = await s2.get_links_batch(expand_nodes)
    hop2_ids = set(hop1_ids)
    for pid, (refs, citers) in links2.items():
        hop2_ids.update(refs.keys())
        hop2_ids.update(citers.keys())

    # 3. Compute coverage score
    total_network_nodes = len(hop2_ids)
    captured = len(hop1_ids)
    coverage_score = round(captured / total_network_nodes, 3) if total_network_nodes > 0 else 0.0

    # 4. Find missing anchors candidates from 1-hop
    missing_candidates = list(hop1_ids - set(paper_ids))[:1000]
    if not missing_candidates:
        return {
            "coverage_score": coverage_score,
            "total_network_nodes": total_network_nodes,
            "captured_nodes": captured,
            "missing_anchors": [],
            "ready_to_write": coverage_score >= 0.85,
            "threshold": 0.85
        }

    meta = await s2.get_papers_batch(missing_candidates)
    
    missing_candidates_sorted = sorted(
        missing_candidates, 
        key=lambda x: meta.get(x, {}).get("citation_count", 0) or 0, 
        reverse=True
    )
    
    top_50_missing = missing_candidates_sorted[:50]
    seed_ids_for_graph = paper_ids + top_50_missing

    # 5. Reuse SPECTER2 embedding + K-Means clustering logic from graph.py
    graph_data = await build_graph(s2, seed_ids_for_graph)
    nodes_data = {n["id"]: n for n in graph_data.get("nodes", [])}
    edges_data = graph_data.get("edges", [])

    missing_anchors = []
    processed_missing = [n for n in nodes_data.values() if n["id"] not in paper_ids]
    processed_missing.sort(key=lambda x: x.get("citation_count", 0) or 0, reverse=True)

    for anchor in processed_missing[:5]:
        anchor_id = anchor["id"]
        cluster = anchor.get("cluster", "Research Cluster")
        
        connected = any(
            (e["source"] == anchor_id and e["target"] in paper_ids) or 
            (e["target"] == anchor_id and e["source"] in paper_ids)
            for e in edges_data
        )
        
        why_missing = (
            f"High-citation hub in {cluster} that is loosely connected to your current set" 
            if connected else 
            f"High-citation hub in {cluster} with no connection to your current set"
        )
        
        missing_anchors.append({
            "paperId": anchor_id,
            "title": anchor.get("label", "(untitled)"),
            "citationCount": anchor.get("citation_count", 0),
            "why_missing": why_missing
        })

    return {
        "coverage_score": coverage_score,
        "total_network_nodes": total_network_nodes,
        "captured_nodes": captured,
        "missing_anchors": missing_anchors,
        "ready_to_write": coverage_score >= 0.85,
        "threshold": 0.85
    }


@app.get("/paper/{paper_id}")
async def get_paper_endpoint(paper_id: str, request: Request) -> dict[str, Any]:
    """Fetch a single paper's full metadata by Semantic Scholar ID."""
    s2: SemanticScholar = request.app.state.s2
    if not s2:
        raise HTTPException(status_code=503, detail="Semantic Scholar API not available")
    
    batch = await s2.get_papers_batch([paper_id])
    if not batch or paper_id not in batch:
        raise HTTPException(status_code=404, detail=f"Paper {paper_id} not found")
    
    return {"paper": batch[paper_id]}
