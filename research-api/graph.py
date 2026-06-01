"""
Relations graph builder — Semantic Topography.

Replaces co-citation clustering with SPECTER2 vector embeddings and K-Means.
Uses direct citations + cosine similarity fallback for edges.
"""

from __future__ import annotations

import logging
import os
from typing import Any
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics.pairwise import cosine_similarity
from openai import AsyncOpenAI

from sources.semantic_scholar import SemanticScholar

log = logging.getLogger(__name__)


async def classify_intent(context: str) -> str:
    """Classifies citation context into specific semantic buckets using OpenAI or Groq."""
    openai_key = os.getenv("OPENAI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    if openai_key and len(openai_key) > 10:
        client = AsyncOpenAI(api_key=openai_key)
        model = "gpt-4o-mini"
    elif groq_key and len(groq_key) > 10:
        client = AsyncOpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
        model = "llama-3.1-70b-versatile"
    else:
        return "General Reference"

    prompt = (
        "Classify the following academic citation context into exactly one of "
        "these categories: 'Refutes', 'Builds Upon', 'Applies Method', or "
        "'General Reference'. Context: \"" + context + "\". Reply with ONLY the category name."
    )

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=10,
            temperature=0,
        )
        cat = resp.choices[0].message.content.strip().strip("'\"")
        valid = {"Refutes", "Builds Upon", "Applies Method", "General Reference"}
        return cat if cat in valid else "General Reference"
    except Exception as e:
        log.warning("LLM classification failed: %s", e)
        return "General Reference"


async def build_graph(
    s2: SemanticScholar,
    seed_ids: list[str],
    top_n: int = 30,
    min_edge: float = 0.05,
) -> dict[str, Any]:
    if not seed_ids:
        return {"nodes": [], "edges": []}

    # 1. Fetch metadata & embeddings for seeds
    meta = await s2.get_papers_batch(seed_ids)
    valid_ids = [sid for sid in seed_ids if sid in meta]
    if not valid_ids:
        return {"nodes": [], "edges": []}

    # 2. Extract embeddings and run K-Means clustering
    embeddings: list[list[float]] = []
    embed_ids: list[str] = []
    for sid in valid_ids:
        emb = meta[sid].get("specter_v2")
        if emb and len(emb) > 0:
            embeddings.append(emb)
            embed_ids.append(sid)

    clusters_map: dict[str, str] = {}
    if len(embeddings) >= 3:
        n_clusters = min(4, len(embeddings))
        X = np.array(embeddings)
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10).fit(X)
        # Name clusters by their dominant topic (use first paper's title keyword)
        cluster_labels: dict[int, str] = {}
        for i, sid in enumerate(embed_ids):
            label = int(kmeans.labels_[i])
            if label not in cluster_labels:
                title = meta[sid].get("title", "")
                # Use first 2-3 words as cluster name
                words = title.split()[:3]
                cluster_labels[label] = " ".join(words) if words else f"Topic {label + 1}"
            clusters_map[sid] = cluster_labels[label]
    else:
        for sid in valid_ids:
            clusters_map[sid] = "Research Cluster"

    # For papers without embeddings, assign to nearest cluster or default
    for sid in valid_ids:
        if sid not in clusters_map:
            clusters_map[sid] = "Research Cluster"

    # 3. Fetch explicit links (refs & citers) with contexts and intents
    links = await s2.get_links_batch(valid_ids)

    # 4. Build Node List
    nodes: list[dict[str, Any]] = []
    for sid in valid_ids:
        p = meta[sid]
        nodes.append({
            "id": sid,
            "label": p.get("title") or "(untitled)",
            "year": p.get("year"),
            "authors": (p.get("authors") or [])[:3],
            "citation_count": p.get("citation_count") or 0,
            "cluster": clusters_map.get(sid, "Research Cluster"),
        })

    # 5. Build Edge List — direct citations between seed papers
    valid_set = set(valid_ids)
    edges: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str]] = set()

    for sid in valid_ids:
        refs, _ = links.get(sid, ({}, {}))
        for ref_id, data in refs.items():
            if ref_id in valid_set:
                edge_key = (min(ref_id, sid), max(ref_id, sid))
                if edge_key in seen_edges:
                    continue
                seen_edges.add(edge_key)

                intents = data.get("intents") or []
                contexts = data.get("contexts") or []

                mapped_intent = "General Reference"
                if "methodology" in intents:
                    mapped_intent = "Applies Method"
                elif "result" in intents:
                    mapped_intent = "Builds Upon"
                elif "background" in intents:
                    mapped_intent = "General Reference"
                elif len(contexts) > 0:
                    mapped_intent = await classify_intent(contexts[0])

                edges.append({
                    "source": ref_id,
                    "target": sid,
                    "weight": 0.8,
                    "intent": mapped_intent,
                    "context": contexts[0] if contexts else "",
                })

    # 6. FALLBACK — if too few direct citation edges, add cosine similarity edges
    #    from SPECTER2 embeddings so the graph always has connections.
    if len(edges) < len(valid_ids) - 1 and len(embeddings) >= 2:
        log.info("Only %d citation edges for %d nodes — adding similarity edges", len(edges), len(valid_ids))
        X = np.array(embeddings)
        sim_matrix = cosine_similarity(X)

        # Collect (score, i, j) pairs and sort by similarity descending
        pairs = []
        for i in range(len(embed_ids)):
            for j in range(i + 1, len(embed_ids)):
                pairs.append((sim_matrix[i][j], i, j))
        pairs.sort(reverse=True)

        # Add top-N similarity edges until we have enough connectivity
        target_edges = max(len(valid_ids), len(valid_ids) * 2)
        for score, i, j in pairs:
            if len(edges) >= target_edges:
                break
            if score < min_edge:
                break
            sid_a = embed_ids[i]
            sid_b = embed_ids[j]
            edge_key = (min(sid_a, sid_b), max(sid_a, sid_b))
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)
            edges.append({
                "source": sid_a,
                "target": sid_b,
                "weight": round(float(score), 3),
                "intent": "Similar Research",
                "context": "",
            })

    return {"nodes": nodes, "edges": edges}
