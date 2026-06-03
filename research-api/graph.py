"""
Relations graph builder — Semantic Topography.

Replaces co-citation clustering with SPECTER2 vector embeddings and K-Means.
Uses direct citations + cosine similarity fallback for edges.
"""

from __future__ import annotations

import logging
from typing import Any
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics.pairwise import cosine_similarity

from llm import get_llm
from sources.semantic_scholar import SemanticScholar

log = logging.getLogger(__name__)

try:
    import networkx as nx
    _HAS_NX = True
except ImportError:
    _HAS_NX = False
    log.warning("networkx not installed — structural bridge signals disabled")


async def classify_intent(context: str) -> str:
    """Classifies citation context into specific semantic buckets using the active LLM provider."""
    client, model = get_llm()
    if client is None:
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
        # Name clusters by their most central paper's title (longest common noun phrase
        # across member titles, falling back to "Cluster N").
        cluster_members: dict[int, list[str]] = {}
        for i, sid in enumerate(embed_ids):
            label = int(kmeans.labels_[i])
            cluster_members.setdefault(label, []).append(sid)

        cluster_labels: dict[int, str] = {}
        for label, members in cluster_members.items():
            # Pick the member closest to its cluster centroid as the representative
            centroid = kmeans.cluster_centers_[label]
            best_sid = min(
                members,
                key=lambda s: float(np.linalg.norm(
                    np.array(meta[s].get("specter_v2") or centroid) - centroid
                )),
            )
            title = meta[best_sid].get("title") or ""
            # Strip common stop words and take the first meaningful noun phrase (≤4 words)
            _STOP = {"a","an","the","of","in","on","for","and","with","to","using","via","by","from"}
            meaningful = [w for w in title.split() if w.lower() not in _STOP and len(w) > 2]
            cluster_labels[label] = " ".join(meaningful[:4]) if meaningful else f"Cluster {label + 1}"

        for i, sid in enumerate(embed_ids):
            label = int(kmeans.labels_[i])
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
            "url": p.get("url"),
            "tldr": (p.get("tldr") or "")[:200] or None,
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


def compute_gap_signals(
    valid_ids: list[str],
    meta: dict[str, dict],
    embeddings: list[list[float]],
    embed_ids: list[str],
    clusters_map: dict[str, str],
    edges: list[dict],
) -> dict:
    """Compute gap signals from citation graph and embeddings.

    Returns:
        {
          "white_space": [{"cluster_a", "cluster_b", "similarity", "citation_count"}],
          "bridges": [{"paper_id", "title", "year", "betweenness", "citation_count"}],
          "contradictions": [{"source_id", "source_title", "target_id", "target_title", "context"}]
        }
    """
    # --- White-space detector ---
    cluster_to_ids: dict[str, list[str]] = {}
    for sid, cname in clusters_map.items():
        cluster_to_ids.setdefault(cname, []).append(sid)
    cluster_names = list(cluster_to_ids.keys())

    white_space = []
    if len(embeddings) > 0 and len(cluster_names) >= 2:
        X = np.array(embeddings)
        id_to_idx = {eid: i for i, eid in enumerate(embed_ids)}

        # Build edge set for inter-cluster citation counting
        edge_set: set[tuple[str, str]] = set()
        for e in edges:
            edge_set.add((e["source"], e["target"]))

        for i, ca in enumerate(cluster_names):
            for cb in cluster_names[i + 1:]:
                ids_a = cluster_to_ids.get(ca, [])
                ids_b = cluster_to_ids.get(cb, [])

                # Count inter-cluster citation edges (in either direction)
                cite_count = sum(
                    1 for a in ids_a for b in ids_b
                    if (a, b) in edge_set or (b, a) in edge_set
                )

                emb_a = [X[id_to_idx[sid]] for sid in ids_a if sid in id_to_idx]
                emb_b = [X[id_to_idx[sid]] for sid in ids_b if sid in id_to_idx]
                if not emb_a or not emb_b:
                    continue

                sim = float(np.mean(cosine_similarity(np.array(emb_a), np.array(emb_b))))

                # White space = semantically close but sparsely cited across
                if sim >= 0.35:
                    white_space.append({
                        "cluster_a": ca,
                        "cluster_b": cb,
                        "similarity": round(sim, 3),
                        "citation_count": cite_count,
                    })

    white_space.sort(key=lambda x: (x["citation_count"], -x["similarity"]))

    # --- Structural bridges (via NetworkX betweenness) ---
    bridges = []
    if _HAS_NX and len(valid_ids) > 2:
        try:
            G = nx.DiGraph()
            G.add_nodes_from(valid_ids)
            for e in edges:
                G.add_edge(e["source"], e["target"])
            bc = nx.betweenness_centrality(G, normalized=True)
            for nid, score in sorted(bc.items(), key=lambda x: x[1], reverse=True)[:5]:
                if score < 0.05:
                    continue
                node_meta = meta.get(nid, {})
                cit = node_meta.get("citation_count", 0)
                if cit < 100:  # under-cited for its bridging role
                    bridges.append({
                        "paper_id": nid,
                        "title": node_meta.get("title", "(untitled)"),
                        "year": node_meta.get("year"),
                        "betweenness": round(score, 3),
                        "citation_count": cit,
                    })
        except Exception as e:
            log.warning("Betweenness computation failed: %s", e)

    # --- Contradiction edges ---
    contradictions = []
    for e in edges:
        if e.get("intent") == "Refutes" and e.get("context"):
            src = meta.get(e["source"], {})
            tgt = meta.get(e["target"], {})
            contradictions.append({
                "source_id": e["source"],
                "source_title": src.get("title", "(untitled)"),
                "target_id": e["target"],
                "target_title": tgt.get("title", "(untitled)"),
                "context": e["context"][:300],
            })

    return {
        "white_space": white_space[:4],
        "bridges": bridges[:3],
        "contradictions": contradictions[:5],
    }
