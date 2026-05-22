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

// Palette tuned for a near-black canvas.
const SEED_FILL = "#f8fafc";          // slate-50 — anchor papers, brightest on dark
const NODE_FILL = "#94a3b8";          // slate-400 — neutral non-seed
const HOVER_FILL = "#f87171";         // red-400 — focused element
const NEIGHBOR_ACCENT = "#fbbf24";    // amber-400 — connected to focused
const SEED_DIM = "rgba(248, 250, 252, 0.18)";
const NODE_DIM = "rgba(148, 163, 184, 0.15)";
const EDGE_BASE = "rgba(161, 161, 170, 0.18)";    // zinc-400 @ 18%
const EDGE_DIM = "rgba(161, 161, 170, 0.05)";
const EDGE_NEIGHBOR = "rgba(251, 191, 36, 0.85)";
const LABEL_FILL = "#e4e4e7";         // zinc-200
const LABEL_HOVER = "#fecaca";        // red-200
const LABEL_HALO = "rgba(9, 9, 11, 0.85)";  // zinc-950 @ 85% — dark halo on dark bg

const CANVAS_BG = "#09090b"; // zinc-950 — matches page bg so the graph blends

// Sizing
const SEED_R = 3.2;
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
  // this, hover styling never appears once the layout has settled.
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

  const fitView = () => fgRef.current?.zoomToFit?.(400, 40);

  return (
    <section>
      <div className="flex items-end justify-between mb-3">
        <h2 className="text-xl font-semibold text-zinc-100">Relations graph</h2>
        <Legend />
      </div>
      <p className="text-xs text-zinc-400 mb-2">
        Bright dots = seed papers from the list above. Edges combine{" "}
        <em>bibliographic coupling</em> (shared references) and{" "}
        <em>co-citation</em> (shared citers). Hover a dot to highlight its
        connections; drag to pan, scroll to zoom.
      </p>
      {loading && (
        <p className="text-zinc-400">Building the graph (this can take ~30s)…</p>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!loading && data && data.nodes.length === 0 && (
        <p className="text-zinc-500 text-sm">Not enough citation data to build a graph.</p>
      )}
      <div
        className="relative border border-zinc-800 rounded-lg overflow-hidden"
        style={{ height: 520, background: CANVAS_BG }}
      >
        {graphData.nodes.length > 0 && (
          <>
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              height={520}
              backgroundColor={CANVAS_BG}
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
                ctx.lineWidth = Math.max(3 / scale, 0.8);
                ctx.strokeStyle = LABEL_HALO;
                ctx.strokeText(txt, node.x + r + 2, node.y);
                ctx.fillStyle = isHover ? LABEL_HOVER : LABEL_FILL;
                ctx.fillText(txt, node.x + r + 2, node.y);
              }}
              // Hit area scales with visible dot size. A uniform large radius
              // makes seeds steal the pointer area of nearby small nodes.
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
            <button
              onClick={fitView}
              className="absolute top-2 right-2 px-2.5 py-1 text-xs rounded-md bg-zinc-900/80 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition-colors backdrop-blur"
              title="Fit graph to view"
            >
              Fit view
            </button>
          </>
        )}
      </div>
      {data && (
        <p className="text-xs text-zinc-500 mt-2">
          {data.nodes.length} nodes · {data.edges.length} edges · larger dots = higher similarity
        </p>
      )}
    </section>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-zinc-400">
      <LegendDot color={SEED_FILL} label="seed" />
      <LegendDot color={NODE_FILL} label="related" />
      <LegendDot color={HOVER_FILL} label="hovered" />
      <LegendDot color={NEIGHBOR_ACCENT} label="connected" ring />
    </div>
  );
}

function LegendDot({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={
          ring
            ? { background: "transparent", boxShadow: `inset 0 0 0 1.5px ${color}` }
            : { background: color }
        }
      />
      {label}
    </span>
  );
}
