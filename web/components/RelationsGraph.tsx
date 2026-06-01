"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// @ts-ignore — elkjs bundled has no type declarations
import ELK from "elkjs/lib/elk.bundled.js";

import PaperNode from "./graph/PaperNode";
import ClusterGroupNode from "./graph/ClusterGroupNode";
import SemanticEdge from "./graph/SemanticEdge";
import type { GraphResponse } from "@/lib/types";

const elk = new ELK();

// Must be OUTSIDE the component to prevent React Flow infinite re-renders.
const nodeTypes = { paper: PaperNode, cluster: ClusterGroupNode };
const edgeTypes = { semantic: SemanticEdge };

type Props = {
  loading: boolean;
  error: string | null;
  data: GraphResponse | null;
};

// SVG arrow marker definitions for each intent color
function ArrowDefs() {
  const arrows = [
    { id: "arrow-BuildsUpon", color: "#10b981" },
    { id: "arrow-AppliesMethod", color: "#3b82f6" },
    { id: "arrow-Refutes", color: "#ef4444" },
    { id: "arrow-SimilarResearch", color: "#a78bfa" },
    { id: "arrow-GeneralReference", color: "#71717a" },
  ];
  return (
    <svg style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0 }}>
      <defs>
        {arrows.map((a) => (
          <marker
            key={a.id}
            id={a.id}
            viewBox="0 0 20 20"
            refX="18"
            refY="10"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 20 10 L 0 20 z" fill={a.color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

function GraphInner({ data }: { data: GraphResponse }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const runLayout = async () => {
      // Node size for the compact circular nodes
      const NODE_W = 80;
      const NODE_H = 80;

      // Find unique clusters
      const clusterNames = Array.from(new Set(data.nodes.map(n => n.cluster || "Research Cluster")));
      const PAD = 40;

      // Build hierarchical ELK graph
      const elkGraph = {
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "80",
          "elk.layered.spacing.nodeNodeBetweenLayers": "120",
          "elk.padding": `[top=${PAD},left=${PAD},bottom=${PAD},right=${PAD}]`,
        },
        children: clusterNames.map(cl => ({
          id: `cluster-${cl}`,
          layoutOptions: {
            "elk.padding": `[top=100,left=${PAD},bottom=${PAD},right=${PAD}]`,
          },
          children: data.nodes
            .filter(n => (n.cluster || "Research Cluster") === cl)
            .map(n => ({
              id: n.id,
              width: NODE_W,
              height: NODE_H,
            }))
        })),
        edges: data.edges.map((e, i) => ({
          id: `e${i}`,
          sources: [e.source],
          targets: [e.target],
        })),
      };

      try {
        const layout = await elk.layout(elkGraph);
        const posMap = new Map<string, { x: number; y: number }>();
        const newNodes: Node[] = [];

        // Map layout positions. We compute global coordinates by adding parent offsets.
        layout.children?.forEach((clusterNode: any) => {
          const cx = clusterNode.x ?? 0;
          const cy = clusterNode.y ?? 0;

          // Push visual background for cluster
          if (clusterNames.length > 1) {
            newNodes.push({
              id: clusterNode.id,
              type: "cluster",
              data: { label: clusterNode.id.replace("cluster-", "") },
              position: { x: cx, y: cy },
              style: { width: clusterNode.width ?? 0, height: clusterNode.height ?? 0, zIndex: -1 },
              selectable: false,
              draggable: false,
            });
          }

          clusterNode.children?.forEach((child: any) => {
            posMap.set(child.id, {
              x: cx + (child.x ?? 0),
              y: cy + (child.y ?? 0),
            });
          });
        });

        // Paper nodes
        for (const n of data.nodes) {
          const pos = posMap.get(n.id) || { x: 0, y: 0 };
          newNodes.push({
            id: n.id,
            type: "paper",
            data: {
              label: n.label,
              year: n.year,
              authors: n.authors,
              citation_count: n.citation_count,
            },
            position: pos,
          });
        }

        // Edges
        const newEdges: Edge[] = data.edges.map((e, i) => ({
          id: `e${i}`,
          source: e.source,
          target: e.target,
          type: "semantic",
          data: { intent: e.intent || "General Reference", context: e.context || "", weight: e.weight },
          animated: true,
          style: { strokeWidth: 2.5 },
        }));

        setNodes(newNodes);
        setEdges(newEdges);

        // Fit view after layout
        setTimeout(() => fitView({ padding: 0.15 }), 100);
      } catch (err) {
        console.error("ELK layout error:", err);
        // Fallback: circular layout
        const cx = 400, cy = 300, radius = Math.max(200, data.nodes.length * 30);
        const newNodes: Node[] = data.nodes.map((n, i) => {
          const angle = (2 * Math.PI * i) / data.nodes.length;
          return {
            id: n.id,
            type: "paper",
            data: { label: n.label, year: n.year, authors: n.authors, citation_count: n.citation_count },
            position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
          };
        });
        const newEdges: Edge[] = data.edges.map((e, i) => ({
          id: `e${i}`,
          source: e.source,
          target: e.target,
          type: "semantic",
          data: { intent: e.intent || "General Reference", context: e.context || "" },
          animated: true,
        }));
        setNodes(newNodes);
        setEdges(newEdges);
        setTimeout(() => fitView({ padding: 0.15 }), 100);
      }
    };

    runLayout();
  }, [data, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      minZoom={0.1}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      defaultEdgeOptions={{ animated: true }}
    >
      <ArrowDefs />
      <Background color="#27272a" gap={24} size={1} />
      <Controls
        className="!bg-zinc-900 !border-zinc-700 !text-zinc-300 !shadow-xl"
        showInteractive={false}
      />
      <MiniMap
        nodeColor={() => "#10b981"}
        maskColor="rgba(0,0,0,0.7)"
        className="!bg-zinc-900 !border-zinc-700"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}

export default function RelationsGraph({ loading, error, data }: Props) {
  return (
    <section>
      <div className="flex items-end justify-between mb-3">
        <h2 className="text-xl font-semibold text-zinc-100">Relations graph</h2>
        <Legend />
      </div>
      <p className="text-xs text-zinc-400 mb-2">
        Hover nodes for details. Click edge labels to see citation context. Drag nodes to rearrange.
      </p>

      {loading && <p className="text-zinc-400">Building the graph (this can take ~30s)…</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!loading && data && data.nodes.length === 0 && (
        <p className="text-zinc-500 text-sm">Not enough citation data to build a graph.</p>
      )}

      <div className="relative border border-zinc-800 rounded-xl overflow-hidden bg-[#09090b]" style={{ height: 750 }}>
        {!loading && data && data.nodes.length > 0 && (
          <ReactFlowProvider>
            <GraphInner data={data} />
          </ReactFlowProvider>
        )}
      </div>

      {data && (
        <p className="text-xs text-zinc-500 mt-2">
          {data.nodes.length} papers · {data.edges.length} connections
        </p>
      )}
    </section>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-zinc-400 flex-wrap">
      <LegendDot color="#10b981" label="Builds Upon" />
      <LegendDot color="#3b82f6" label="Applies Method" />
      <LegendDot color="#ef4444" label="Refutes" />
      <LegendDot color="#a78bfa" label="Similar" />
      <LegendDot color="#71717a" label="General" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
