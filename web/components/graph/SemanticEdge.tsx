"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import { useState } from "react";
import type { Position } from "@xyflow/react";

type SemanticEdgeData = {
  intent?: string;
  context?: string;
  weight?: number;
};

type SemanticEdgeProps = {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  style?: React.CSSProperties;
  markerEnd?: string;
  data?: SemanticEdgeData;
};

const INTENT_COLORS: Record<string, { stroke: string; text: string; bg: string }> = {
  "Builds Upon":      { stroke: "#10b981", text: "text-emerald-300", bg: "bg-emerald-950/80 border-emerald-600" },
  "Applies Method":   { stroke: "#3b82f6", text: "text-blue-300",    bg: "bg-blue-950/80 border-blue-600" },
  "Refutes":          { stroke: "#ef4444", text: "text-red-300",     bg: "bg-red-950/80 border-red-600" },
  "Similar Research": { stroke: "#a78bfa", text: "text-violet-300",  bg: "bg-violet-950/80 border-violet-600" },
  "General Reference":{ stroke: "#71717a", text: "text-zinc-300",    bg: "bg-zinc-800/80 border-zinc-600" },
};

export default function SemanticEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: SemanticEdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const [showContext, setShowContext] = useState(false);

  const intent = data?.intent ?? "General Reference";
  const context = data?.context ?? "";
  const colors = INTENT_COLORS[intent] || INTENT_COLORS["General Reference"];

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: colors.stroke,
          strokeWidth: intent === "Similar Research" ? 1.5 : 2.5,
          strokeOpacity: intent === "Similar Research" ? 0.3 : 0.8,
          strokeDasharray: intent === "Similar Research" ? "5, 5" : "none",
        }}
        markerEnd={intent === "Similar Research" ? undefined : `url(#arrow-${intent.replace(/\s/g, "")})`}
      />
      {intent !== "Similar Research" && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <button
              onClick={() => context && setShowContext(!showContext)}
              className={`px-2 py-0.5 text-[9px] font-semibold border rounded-full backdrop-blur-sm shadow-lg transition-all hover:scale-110 ${colors.text} ${colors.bg} ${context ? "cursor-pointer" : "cursor-default"}`}
            >
              {intent}
            </button>

            {showContext && context && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-60 p-2.5 bg-zinc-900/95 backdrop-blur border border-zinc-700 text-xs text-zinc-300 rounded-lg shadow-2xl z-[100]">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-semibold text-zinc-100 text-[10px]">Citation Context</span>
                  <button onClick={() => setShowContext(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
                </div>
                <p className="italic text-[10px] leading-relaxed">&ldquo;{String(context)}&rdquo;</p>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
