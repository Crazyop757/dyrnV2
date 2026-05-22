"""
Relations graph builder — bibliographic coupling + co-citation.

Port of SpiderPDF's pipeline/graph.py, optimized for the MVP by using
Semantic Scholar's batch endpoint to fetch references+citations in bulk
(one HTTP call per ~400 papers, instead of one call per paper).

Algorithm:
  For each seed paper, fetch its references (papers it cites) and citations
  (papers that cite it). The candidate pool = the union of all those IDs.
  For every pair of papers in (seeds + top candidates):

      similarity(A, B) = cosine(refs_A, refs_B)   # bibliographic coupling
                      + cosine(citers_A, citers_B) # co-citation

  Keep nodes whose similarity to ANY seed is > 0; keep edges with sim >= min_edge.

Returns a dict {nodes, edges} ready for react-force-graph-2d.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from sources.semantic_scholar import SemanticScholar

log = logging.getLogger(__name__)


# Cap how many candidates we expand. Larger pool = better graph, but each
# additional candidate is ~one extra paperId in a batch call. 80 is plenty
# for a readable graph and keeps the second batch call cheap.
_MAX_CANDIDATES = 50


def _cosine(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / math.sqrt(len(a) * len(b))


def _similarity(refs_a: set[str], refs_b: set[str], citers_a: set[str], citers_b: set[str]) -> float:
    return _cosine(refs_a, refs_b) + _cosine(citers_a, citers_b)


async def build_graph(
    s2: SemanticScholar,
    seed_ids: list[str],
    top_n: int = 30,
    min_edge: float = 0.05,
) -> dict[str, Any]:
    if not seed_ids:
        return {"nodes": [], "edges": []}

    # 1. Fetch refs+citers for all seeds in one batch.
    seed_links = await s2.get_links_batch(seed_ids)
    seed_refs = {sid: seed_links.get(sid, (set(), set()))[0] for sid in seed_ids}
    seed_citers = {sid: seed_links.get(sid, (set(), set()))[1] for sid in seed_ids}

    # 2. Candidate pool = everything we discovered, minus the seeds themselves.
    candidates: set[str] = set()
    for sid in seed_ids:
        candidates |= seed_refs[sid]
        candidates |= seed_citers[sid]
    candidates -= set(seed_ids)

    if not candidates:
        seeds_meta = await s2.get_papers_batch(seed_ids)
        return {
            "nodes": [_node(seeds_meta.get(sid, {"id": sid, "title": sid}), is_seed=True) for sid in seed_ids],
            "edges": [],
        }

    # Trim: keep the candidates that appear in the most seed neighborhoods —
    # those are the ones most likely to score well anyway.
    candidate_freq: dict[str, int] = {}
    for sid in seed_ids:
        for cid in seed_refs[sid] | seed_citers[sid]:
            candidate_freq[cid] = candidate_freq.get(cid, 0) + 1
    ranked_cands = sorted(candidates, key=lambda c: -candidate_freq.get(c, 0))
    cand_list = ranked_cands[:_MAX_CANDIDATES]

    log.info(
        "graph: %d seeds, %d candidates (trimmed from %d), top_n=%d",
        len(seed_ids), len(cand_list), len(candidates), top_n,
    )

    # 3. Fetch refs+citers for all trimmed candidates in one batch.
    cand_links = await s2.get_links_batch(cand_list)
    cand_refs = {cid: cand_links.get(cid, (set(), set()))[0] for cid in cand_list}
    cand_citers = {cid: cand_links.get(cid, (set(), set()))[1] for cid in cand_list}

    # 4. Score each candidate vs each seed; keep max score across seeds.
    scores: dict[str, float] = {}
    for cid in cand_list:
        best = 0.0
        for sid in seed_ids:
            s = _similarity(cand_refs[cid], seed_refs[sid], cand_citers[cid], seed_citers[sid])
            if s > best:
                best = s
        scores[cid] = best

    ranked = sorted(
        ((cid, s) for cid, s in scores.items() if s > 0),
        key=lambda x: -x[1],
    )[:top_n]
    top_ids = [cid for cid, _ in ranked]

    # 5. Pull display metadata for seeds + top candidates.
    meta = await s2.get_papers_batch(list(set(seed_ids + top_ids)))

    nodes: list[dict[str, Any]] = []
    for sid in seed_ids:
        nodes.append(_node(meta.get(sid, {"id": sid, "title": sid}), is_seed=True, score=1.0))
    for cid, s in ranked:
        if cid in meta:
            nodes.append(_node(meta[cid], is_seed=False, score=s))

    # 6. Build edges between every pair in {seeds ∪ top}.
    all_ids = seed_ids + top_ids
    refs_map = {**seed_refs, **{cid: cand_refs[cid] for cid in top_ids}}
    citers_map = {**seed_citers, **{cid: cand_citers[cid] for cid in top_ids}}
    edges: list[dict[str, Any]] = []
    for i, a in enumerate(all_ids):
        for b in all_ids[i + 1 :]:
            sim = _similarity(refs_map[a], refs_map[b], citers_map[a], citers_map[b])
            if sim >= min_edge:
                edges.append({"source": a, "target": b, "weight": round(sim, 4)})

    return {"nodes": nodes, "edges": edges}


def _node(p: dict[str, Any], is_seed: bool, score: float | None = None) -> dict[str, Any]:
    return {
        "id": p.get("id") or "",
        "label": p.get("title") or "(untitled)",
        "year": p.get("year"),
        "authors": (p.get("authors") or [])[:3],
        "citation_count": p.get("citation_count") or 0,
        "is_seed": is_seed,
        "score": round(score, 4) if score is not None else None,
    }
