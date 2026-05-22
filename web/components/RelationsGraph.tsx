"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphResponse } from "@/lib/types";

// react-force-graph-2d uses canvas + window — must be client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type Props = {
  loading: boolean;
  error: string | null;
  data: GraphResponse | null;
};

// Palette
const SEED_FILL = "#0f172a";          // slate-900 — anchor papers
const NODE_FILL = "#94a3b8";          // slate-400 — neutral non-seed
const HOVER_FILL = "#dc2626";         // red-600 — focused element
const NEIGHBOR_ACCENT = "#f59e0b";    // amber-500 — connected to focused
const SEED_DIM = "rgba(15, 23, 42, 0.18)";
const NODE_DIM = "rgba(148, 163, 184, 0.18)";
const EDGE_BASE = "rgba(100, 116, 139, 0.32)";
const EDGE_DIM = "rgba(100, 116, 139, 0.07)";
const EDGE_NEIGHBOR = "rgba(245, 158, 11, 0.85)";

// Sizing
const SEED_R = 3.0;
const NODE_R_MIN = 1.3;
const NODE_R_MAX = 2.4;
const SEED_HIT_R = 8;
const NODE_HIT_R = 5;

function nodeRadius(n: any): number {
  if (n.is_seed) return SEED_R;
  const s = typeof n.score === "number" ? Math.max(0, Math.min(1, n.score)) : 0.5;
  return NODE_R_MIN + (NODE_R_MAX - NODE_R_MIN) * s;
}

export default function RelationsGraph({ loading, error, data }: Props) {
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<{ s: string; t: string } | null>(null);
  const fgRef = useRef<any>(null);

  // Force a single canvas repaint when hover state changes. The simulation
  // cools down (cooldownTicks=120) and stops painting on its own; without
  // this, the hover styling never appears once the layout has settled.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.resumeAnimation?.();
    const id = requestAnimationFrame(() => {
      fg.pauseAnimation?.();
    });
    return () => cancelAnimationFrame(id);
  }, [hoverNode, hoverLink]);

  // react-force-graph mutates the data object. Build a stable copy each time
  // `data` changes; keys = `id` for nodes, `source`/`target` for links.
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.edges.map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
      })),
    };
  }, [data]);

  // Adjacency map so hover can dim non-neighbors in O(1) per node.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!data) return m;
    for (const e of data.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [data]);

  // HTML tooltip — uses <br> because the library renders nodeLabel as HTML,
  // which collapses raw "\n" to a single space.
  function nodeTooltip(n: any): string {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const parts: string[] = [`<b>${esc(n.label || "(untitled)")}</b>`];
    const sub: string[] = [];
    if (n.year) sub.push(String(n.year));
    if (n.authors?.length) sub.push(esc(n.authors.join(", ")));
    if (sub.length) parts.push(sub.join(" — "));
    if (typeof n.citation_count === "number" && n.citation_count > 0) {
      parts.push(`${n.citation_count} citations`);
    }
    if (n.is_seed) {
      parts.push(`<i>seed paper</i>`);
    } else if (typeof n.score === "number") {
      parts.push(`similarity score: <b>${n.score.toFixed(3)}</b>`);
    }
    return parts.join("<br>");
  }

  function linkTooltip(l: any): string {
    const w = typeof l.weight === "number" ? l.weight.toFixed(3) : "?";
    return `similarity: <b>${w}</b><br><span style="opacity:.7">(refs cosine + citers cosine)</span>`;
  }

  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">Relations graph</h2>
      <p className="text-xs text-stone-500 mb-2">
        Dark dots = seed papers from the list above. Edges combine{" "}
        <em>bibliographic coupling</em> (shared references) and{" "}
        <em>co-citation</em> (shared citers). Hover a dot to highlight its
        connections; drag to pan, scroll to zoom.
      </p>
      {loading && (
        <p className="text-stone-500">Building the graph (this can take ~30s)…</p>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!loading && data && data.nodes.length === 0 && (
        <p className="text-stone-500 text-sm">Not enough citation data to build a graph.</p>
      )}
      <div
        className="border border-stone-200 rounded-md overflow-hidden bg-white"
        style={{ height: 520 }}
      >
        {graphData.nodes.length > 0 && (
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            height={520}
            nodeRelSize={3}
            cooldownTicks={120}
            d3VelocityDecay={0.35}
            nodeLabel={nodeTooltip}
            linkLabel={linkTooltip}
            nodeCanvasObject={(node: any, ctx, scale) => {
              const isSeed = !!node.is_seed;
              const isHover = hoverNode === node.id;
              const isNeighbor =
                hoverNode != null &&
                !isHover &&
                !!neighbors.get(hoverNode)?.has(node.id);
              const dim = hoverNode != null && !isHover && !isNeighbor;

              const r = nodeRadius(node);

              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              if (isHover) {
                ctx.fillStyle = HOVER_FILL;
              } else if (isSeed) {
                ctx.fillStyle = dim ? SEED_DIM : SEED_FILL;
              } else {
                ctx.fillStyle = dim ? NODE_DIM : NODE_FILL;
              }
              ctx.fill();

              // Amber ring marks neighbors of the focused node.
              if (isNeighbor) {
                ctx.lineWidth = Math.max(1.2 / scale, 0.5);
                ctx.strokeStyle = NEIGHBOR_ACCENT;
                ctx.stroke();
              }

              // Labels: hidden by default to avoid overlap. Show on hover, on
              // neighbors of a hovered node, or when the user zooms in close.
              const showLabel = isHover || isNeighbor || scale > 3.8;
              if (!showLabel) return;

              const raw = (node.label || "") as string;
              const max = isHover ? 80 : 36;
              const txt = raw.length > max ? raw.slice(0, max - 1) + "…" : raw;
              const size = isHover
                ? Math.max(12 / scale, 4.2)
                : Math.max(9.5 / scale, 3.2);
              ctx.font = `${isHover ? 600 : 400} ${size}px sans-serif`;
              ctx.textBaseline = "middle";
              ctx.lineWidth = Math.max(2.5 / scale, 0.6);
              ctx.strokeStyle = "rgba(255,255,255,0.95)";
              ctx.strokeText(txt, node.x + r + 2, node.y);
              ctx.fillStyle = isHover ? "#7f1d1d" : "#1c1917";
              ctx.fillText(txt, node.x + r + 2, node.y);
            }}
            // Hit area scales with visible dot size. A uniform large radius
            // makes seeds steal the pointer area of nearby small nodes, so
            // hovering a small dot near a seed only highlights the seed.
            nodePointerAreaPaint={(node: any, color, ctx) => {
              const r = node.is_seed ? SEED_HIT_R : NODE_HIT_R;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            onNodeHover={(n: any) => setHoverNode(n ? n.id : null)}
            linkColor={(l: any) => {
              const src = typeof l.source === "object" ? l.source.id : l.source;
              const tgt = typeof l.target === "object" ? l.target.id : l.target;
              const isHoverLink =
                hoverLink && hoverLink.s === src && hoverLink.t === tgt;
              if (isHoverLink) return HOVER_FILL;
              if (hoverNode != null) {
                const touches = src === hoverNode || tgt === hoverNode;
                return touches ? EDGE_NEIGHBOR : EDGE_DIM;
              }
              return EDGE_BASE;
            }}
            linkWidth={(l: any) => {
              const src = typeof l.source === "object" ? l.source.id : l.source;
              const tgt = typeof l.target === "object" ? l.target.id : l.target;
              const isHoverLink =
                hoverLink && hoverLink.s === src && hoverLink.t === tgt;
              const base = Math.max(0.3, (l.weight ?? 0) * 1.6);
              if (isHoverLink) return base + 1.3;
              if (hoverNode != null && (src === hoverNode || tgt === hoverNode)) {
                return base + 0.7;
              }
              return base;
            }}
            onLinkHover={(l: any) => {
              if (!l) return setHoverLink(null);
              const src = typeof l.source === "object" ? l.source.id : l.source;
              const tgt = typeof l.target === "object" ? l.target.id : l.target;
              setHoverLink({ s: src, t: tgt });
            }}
            linkHoverPrecision={6}
          />
        )}
      </div>
      {data && (
        <p className="text-xs text-stone-500 mt-2">
          {data.nodes.length} nodes · {data.edges.length} edges · larger dots ={" "}
          higher similarity
        </p>
      )}
    </section>
  );
}
