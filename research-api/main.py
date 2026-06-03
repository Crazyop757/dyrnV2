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
    limitation after publication — much stronger signal than self-reporting.
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

    # Step 1 — infer dimensions
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
- Values must be CANONICAL TECHNIQUE / CATEGORY NAMES from the research community — NOT words from paper titles, NOT study types like "Comparative Evaluation" or "Survey"
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

    # Step 2 — classify papers
    paper_blocks = "\n\n".join(
        f"ID: {p.get('id', '')}\nTitle: {p.get('title', '')}\nAbstract: {(p.get('abstract') or p.get('tldr') or '')[:180]}"
        for p in papers[:20]
    )
    cls_prompt = f"""Classify each paper.

Dimension 1 — {dim1_label}: {dim1_values}
Dimension 2 — {dim2_label}: {dim2_values}

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

    # Step 3 — build matrix
    matrix_counts: dict[str, dict[str, list[str]]] = {}
    for cls in classifications:
        d1 = cls.get("dim1", "Other")
        d2 = cls.get("dim2", "Other")
        pid = cls.get("id", "")
        matrix_counts.setdefault(d1, {}).setdefault(d2, []).append(pid)

    # Build rows (exclude Other×Other noise)
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

    # Build citing-paper evidence block (primary evidence — external validation)
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
            lines.append(f"Abstract: {(p.get('abstract') or '')[:250]}…")

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
            f"cross-citations — a likely unexplored interdisciplinary connection."
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

## PRIMARY EVIDENCE — Citing-paper external limitations (strongest signal)
These are quotes from papers that CITE our seed papers and explicitly say something is still missing.
This is external validation: another author confirmed the limitation was still open after the seed paper was published.
{citing_text}

## SECONDARY EVIDENCE — Self-reported limitations / future-work
{papers_text}

## Graph signals (structural gaps from citation network)
{signals_text}

## Output format

Output ONLY valid JSON — nothing else. Use this exact schema:
{{
  "gaps": [
    {{
      "statement": "Clear 1-2 sentence gap statement.",
      "type": "methodological|knowledge|empirical|population|theoretical|evidence_contradictory|practical",
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
3. verification_queries: 3 SPECIFIC, NARROW sub-queries — name a precise method, population, or condition. Bad: "transformer attention mechanisms in stock price prediction". Good: "transformer cross-attention intraday volatility prediction without technical indicators".
4. Do NOT invent gaps unsupported by the evidence above.
5. Output 4-8 gaps. type must be exactly one of the 7 listed values.
6. CRITICAL — gaps must be narrow: a good gap has fewer than 10 papers addressing it. State a specific combination of method + population + outcome, not a broad sub-field. If you can only find broad gaps, say so by outputting fewer gaps."""

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


@app.post("/gap-analysis")
async def gap_analysis_endpoint(body: GapAnalysisRequest) -> dict[str, Any]:
    """Full server-side gap analysis pipeline.

    1. Extract author-stated limitations/future-work (PDF + abstract fallback).
    2. Compute graph signals (white-space between clusters, contradiction edges, bridges).
    3. LLM gap induction seeded by 1+2 — structured JSON, grounded output.
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

    # 4b. Synthesise EGM-derived gaps (pre-verified: count=0 → confirmed, count=1 → partial)
    egm_gaps: list[dict[str, Any]] = []
    for i, cell in enumerate((egm.get("empty_cells") or [])[:5]):
        confidence = "confirmed" if cell["count"] == 0 else "partial"
        egm_gaps.append({
            "id": f"egm-{i + 1}",
            "statement": cell["gap_statement"],
            "type": "empirical",
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
        confidence = "incoherent"  # genuine zero — query may be nonsense
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
