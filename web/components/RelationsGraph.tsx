"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// @ts-ignore
import ELK from "elkjs/lib/elk.bundled.js";
import { useTheme } from "next-themes";

import PaperNode from "./graph/PaperNode";
import ClusterGroupNode from "./graph/ClusterGroupNode";
import SemanticEdge from "./graph/SemanticEdge";
import type { GraphResponse } from "@/lib/types";

const elk = new ELK();
const nodeTypes = { paper: PaperNode, cluster: ClusterGroupNode };
const edgeTypes = { semantic: SemanticEdge };

const CLUSTER_PALETTE = [
  { border: "#10b981", glow: "rgba(16,185,129,0.25)" },
  { border: "#3b82f6", glow: "rgba(59,130,246,0.25)" },
  { border: "#a78bfa", glow: "rgba(167,139,250,0.25)" },
  { border: "#f59e0b", glow: "rgba(245,158,11,0.25)" },
];

const ALL_INTENTS = ["Builds Upon", "Applies Method", "Refutes", "Similar Research", "General Reference"];

const INTENT_STYLE: Record<string, { active: string; dot: string }> = {
  "Builds Upon":       { active: "border-emerald-200 dark:border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40", dot: "bg-emerald-500 dark:bg-emerald-400" },
  "Applies Method":    { active: "border-blue-200 dark:border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40",          dot: "bg-blue-500 dark:bg-blue-400" },
  "Refutes":           { active: "border-red-200 dark:border-red-600 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40",             dot: "bg-red-500 dark:bg-red-400" },
  "Similar Research":  { active: "border-violet-200 dark:border-violet-600 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40",   dot: "bg-violet-500 dark:bg-violet-400" },
  "General Reference": { active: "border-zinc-200 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40",         dot: "bg-zinc-400 dark:bg-zinc-500" },
};

type Props = {
  loading: boolean;
  error: string | null;
  data: GraphResponse | null;
};

function ArrowDefs() {
  return (
    <svg style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0 }}>
      <defs>
        {[
          { id: "arrow-BuildsUpon",       color: "#10b981" },
          { id: "arrow-AppliesMethod",    color: "#3b82f6" },
          { id: "arrow-Refutes",          color: "#ef4444" },
          { id: "arrow-SimilarResearch",  color: "#a78bfa" },
          { id: "arrow-GeneralReference", color: "#71717a" },
        ].map(a => (
          <marker key={a.id} id={a.id} viewBox="0 0 20 20" refX="18" refY="10"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 20 10 L 0 20 z" fill={a.color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function GraphInner({ data, visibleIntents }: { data: GraphResponse; visibleIntents: Set<string> }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setNodes([]); setEdges([]); return;
    }

    const NODE_W = 88;
    const NODE_H = 88;
    const PAD = 60;

    // Assign cluster colors
    const clusterNames = Array.from(new Set(data.nodes.map(n => n.cluster || "Research Cluster")));
    const clusterColorMap = Object.fromEntries(
      clusterNames.map((name, i) => [name, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]])
    );
    const clusterIndexMap = Object.fromEntries(
      clusterNames.map((name, i) => [name, i])
    );

    const runLayout = async () => {
      // Force-directed layout — organic, network-like appearance
      const elkGraph = {
        id: "root",
        layoutOptions: {
          "elk.algorithm": "org.eclipse.elk.force",
          "elk.force.iterations": "2600",
          "elk.spacing.nodeNode": "110",
          "elk.padding": `[top=${PAD},left=${PAD},bottom=${PAD},right=${PAD}]`,
          "elk.force.repulsivePower": "2",
          "elk.separateConnectedComponents": "true",
          "elk.spacing.componentComponent": "120",
        },
        children: clusterNames.map(cl => ({
          id: `cluster-${cl}`,
          layoutOptions: {
            "elk.padding": `[top=80,left=${PAD},bottom=${PAD},right=${PAD}]`,
          },
          children: data.nodes
            .filter(n => (n.cluster || "Research Cluster") === cl)
            .map(n => ({ id: n.id, width: NODE_W, height: NODE_H })),
        })),
        edges: data.edges.map((e, i) => ({
          id: `e${i}`, sources: [e.source], targets: [e.target],
        })),
      };

      try {
        const layout = await elk.layout(elkGraph);
        const posMap = new Map<string, { x: number; y: number }>();
        const newNodes: Node[] = [];

        layout.children?.forEach((clusterNode: any) => {
          const cx = clusterNode.x ?? 0;
          const cy = clusterNode.y ?? 0;
          const cName = clusterNode.id.replace("cluster-", "");

          if (clusterNames.length > 1) {
            newNodes.push({
              id: clusterNode.id,
              type: "cluster",
              data: { label: cName, colorIndex: clusterIndexMap[cName] ?? 0 },
              position: { x: cx, y: cy },
              style: { width: clusterNode.width ?? 0, height: clusterNode.height ?? 0, zIndex: -1 },
              selectable: false,
              draggable: false,
            });
          }

          clusterNode.children?.forEach((child: any) => {
            posMap.set(child.id, { x: cx + (child.x ?? 0), y: cy + (child.y ?? 0) });
          });
        });

        for (const n of data.nodes) {
          const pos = posMap.get(n.id) || { x: 0, y: 0 };
          const clName = n.cluster || "Research Cluster";
          newNodes.push({
            id: n.id,
            type: "paper",
            data: {
              label: n.label,
              year: n.year,
              authors: n.authors,
              citation_count: n.citation_count,
              url: n.url ?? null,
              tldr: n.tldr ?? null,
              clusterColor: clusterColorMap[clName],
              cluster: clName,
            },
            position: pos,
          });
        }

        const newEdges: Edge[] = data.edges.map((e, i) => ({
          id: `e${i}`,
          source: e.source,
          target: e.target,
          type: "semantic",
          data: { intent: e.intent || "General Reference", context: e.context || "", weight: e.weight },
          animated: (e.intent || "General Reference") !== "Similar Research",
          style: { strokeWidth: 2 },
        }));

        setNodes(newNodes);
        setEdges(newEdges);
        setTimeout(() => fitView({ padding: 0.12 }), 120);
      } catch (err) {
        console.error("ELK layout error:", err);
        // Circular fallback
        const cx = 500, cy = 350, radius = Math.max(220, data.nodes.length * 32);
        const clusterNames2 = Array.from(new Set(data.nodes.map(n => n.cluster || "Research Cluster")));
        const clusterColorMap2 = Object.fromEntries(clusterNames2.map((n, i) => [n, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]]));
        const fallbackNodes: Node[] = data.nodes.map((n, i) => {
          const angle = (2 * Math.PI * i) / data.nodes.length;
          const clName = n.cluster || "Research Cluster";
          return {
            id: n.id, type: "paper",
            data: { label: n.label, year: n.year, authors: n.authors, citation_count: n.citation_count, url: n.url ?? null, tldr: n.tldr ?? null, clusterColor: clusterColorMap2[clName], cluster: clName },
            position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
          };
        });
        const fallbackEdges: Edge[] = data.edges.map((e, i) => ({
          id: `e${i}`, source: e.source, target: e.target, type: "semantic",
          data: { intent: e.intent || "General Reference", context: e.context || "" }, animated: true,
        }));
        setNodes(fallbackNodes);
        setEdges(fallbackEdges);
        setTimeout(() => fitView({ padding: 0.12 }), 120);
      }
    };

    runLayout();
  }, [data, fitView]);

  const filteredEdges = edges.filter(e => visibleIntents.has((e.data as any)?.intent ?? "General Reference"));

  const { theme } = useTheme();
  
  return (
    <ReactFlow
      nodes={nodes}
      edges={filteredEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      minZoom={0.08}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
    >
      <ArrowDefs />
      <Background color={theme === "dark" ? "#52525b" : "#d4d4d8"} gap={28} size={1.5} />
      <Controls className="!bg-white dark:!bg-zinc-900 !border-zinc-200 dark:!border-zinc-700 !rounded-lg !shadow-xl" showInteractive={false} />
    </ReactFlow>
  );
}

export default function RelationsGraph({ loading, error, data }: Props) {
  const [visibleIntents, setVisibleIntents] = useState<Set<string>>(new Set(ALL_INTENTS));

  const toggleIntent = useCallback((intent: string) => {
    setVisibleIntents(prev => {
      const next = new Set(prev);
      if (next.has(intent)) { next.delete(intent); } else { next.add(intent); }
      return next;
    });
  }, []);

  const intentCounts = data ? Object.fromEntries(
    ALL_INTENTS.map(intent => [intent, data.edges.filter(e => (e.intent || "General Reference") === intent).length])
  ) : {};

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Relations graph
        </span>
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800/60" />
        {data && (
          <span className="text-[10px] text-zinc-700">
            {data.nodes.length} papers · {data.edges.length} edges
          </span>
        )}
      </div>

      {/* Intent filter toolbar */}
      {data && data.edges.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-700 shrink-0">Show:</span>
          {ALL_INTENTS.filter(i => intentCounts[i] > 0).map(intent => {
            const s = INTENT_STYLE[intent] ?? INTENT_STYLE["General Reference"];
            const active = visibleIntents.has(intent);
            return (
              <button
                key={intent}
                onClick={() => toggleIntent(intent)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] border transition-all ${
                  active ? s.active : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-700 bg-transparent"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${active ? s.dot : "bg-zinc-300 dark:bg-zinc-700"}`} />
                {intent}
                <span className="opacity-50">({intentCounts[intent]})</span>
              </button>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-zinc-600 text-sm mb-3">
          <div className="dot-loader"><span /><span /><span /></div>
          <span>Building graph…</span>
        </div>
      )}
      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-3 mb-3 shadow-sm">{error}</p>
      )}
      {!loading && data && data.nodes.length === 0 && (
        <p className="text-zinc-500 dark:text-zinc-600 text-sm mb-3">Not enough citation data to build a graph.</p>
      )}

      <div
        className="relative border border-zinc-200 dark:border-zinc-800/80 rounded-2xl overflow-hidden bg-white dark:bg-[#0c0c0e] shadow-xl shadow-black/5 dark:shadow-black/40"
        style={{ height: 700 }}
      >
        {!loading && data && data.nodes.length > 0 && (
          <ReactFlowProvider>
            <GraphInner data={data} visibleIntents={visibleIntents} />
          </ReactFlowProvider>
        )}
      </div>

      {/* How to read this — encodings legend */}
      {data && data.nodes.length > 0 && (
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2.5 text-[10px] text-zinc-500 dark:text-zinc-600">
          <span className="text-zinc-600 dark:text-zinc-700 font-medium uppercase tracking-wider text-[9px]">How to read this</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-end gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-300 dark:bg-zinc-500 inline-block" />
            </span>
            size = citation count
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: CLUSTER_PALETTE[0].border }} />
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: CLUSTER_PALETTE[1].border }} />
            color = theme cluster
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-px inline-block bg-zinc-300 dark:bg-zinc-500" />
            edge = citation link (color = type)
          </span>
          <span className="text-zinc-500 dark:text-zinc-700">· hover for details · click a node to open the paper</span>
        </div>
      )}

      {data && data.nodes.length > 0 && <GraphInsights data={data} />}
    </section>
  );
}

function GraphInsights({ data }: { data: GraphResponse }) {
  const clusterNames = Array.from(new Set(data.nodes.map(n => n.cluster || "Research Cluster")));
  const clusterCounts = Object.fromEntries(
    clusterNames.map(c => [c, data.nodes.filter(n => (n.cluster || "Research Cluster") === c).length])
  );

  const mostCited = [...data.nodes].sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))[0];
  const newest = [...data.nodes].filter(n => n.year).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];

  const edgeCounts = new Map<string, number>();
  data.edges.forEach(e => {
    edgeCounts.set(e.source, (edgeCounts.get(e.source) || 0) + 1);
    edgeCounts.set(e.target, (edgeCounts.get(e.target) || 0) + 1);
  });
  const hubId = [...edgeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const hubNode = data.nodes.find(n => n.id === hubId);
  const hubCount = hubId ? (edgeCounts.get(hubId) || 0) : 0;

  const refutesCount = data.edges.filter(e => e.intent === "Refutes").length;

  return (
    <div className="mt-4 space-y-3">
      {/* Cluster legend */}
      <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
        {clusterNames.map((name, i) => (
          <span key={name} className="inline-flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length].border }} />
            <span className="font-medium text-zinc-400">{name}</span>
            <span className="text-zinc-700">({clusterCounts[name]} paper{clusterCounts[name] !== 1 ? "s" : ""})</span>
          </span>
        ))}
      </div>

      {/* Contradiction alert */}
      {refutesCount > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-950/20 border border-red-900/30 text-xs text-red-400/80">
          <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 1L13 12H1L7 1Z" strokeLinejoin="round"/>
            <line x1="7" y1="5" x2="7" y2="8.5"/>
            <circle cx="7" cy="10.5" r="0.5" fill="currentColor"/>
          </svg>
          <span>
            <span className="font-semibold text-red-300">{refutesCount} contradiction{refutesCount !== 1 ? "s" : ""} detected</span>
            {" "}— papers in this set dispute each other's findings. Hover the red edges for context.
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        {mostCited && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/40 bg-white dark:bg-zinc-900/20 px-3 py-2.5 space-y-0.5 shadow-sm">
            <div className="text-[9px] uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Most cited</div>
            <div className="text-xs text-zinc-900 dark:text-zinc-300 font-medium leading-snug line-clamp-2">{mostCited.label}</div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-600">
              {mostCited.citation_count >= 1000
                ? `${(mostCited.citation_count / 1000).toFixed(1)}k citations`
                : `${mostCited.citation_count} citations`}
              {mostCited.year ? ` · ${mostCited.year}` : ""}
            </div>
          </div>
        )}
        {newest && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/40 bg-white dark:bg-zinc-900/20 px-3 py-2.5 space-y-0.5 shadow-sm">
            <div className="text-[9px] uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Most recent</div>
            <div className="text-xs text-zinc-900 dark:text-zinc-300 font-medium leading-snug line-clamp-2">{newest.label}</div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-600">{newest.year}</div>
          </div>
        )}
        {hubNode && hubCount > 1 && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800/40 bg-white dark:bg-zinc-900/20 px-3 py-2.5 space-y-0.5 shadow-sm">
            <div className="text-[9px] uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Most connected</div>
            <div className="text-xs text-zinc-900 dark:text-zinc-300 font-medium leading-snug line-clamp-2">{hubNode.label}</div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-600">{hubCount} connections</div>
          </div>
        )}
      </div>
    </div>
  );
}
