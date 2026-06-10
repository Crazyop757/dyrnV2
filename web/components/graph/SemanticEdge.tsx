"use client";

import { EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import { useRef, useState } from "react";
import type { Position } from "@xyflow/react";

type SemanticEdgeProps = {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: { intent?: string; context?: string; weight?: number };
};

const INTENT_COLORS: Record<string, { stroke: string; text: string; bg: string }> = {
  "Builds Upon":       { stroke: "#10b981", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-700" },
  "Applies Method":    { stroke: "#3b82f6", text: "text-blue-700 dark:text-blue-300",    bg: "bg-blue-50 dark:bg-blue-950/90 border-blue-200 dark:border-blue-700" },
  "Refutes":           { stroke: "#ef4444", text: "text-red-700 dark:text-red-300",     bg: "bg-red-50 dark:bg-red-950/90 border-red-200 dark:border-red-700" },
  "Similar Research":  { stroke: "#a78bfa", text: "text-violet-700 dark:text-violet-300",  bg: "bg-violet-50 dark:bg-violet-950/90 border-violet-200 dark:border-violet-700" },
  "General Reference": { stroke: "#71717a", text: "text-zinc-700 dark:text-zinc-300",    bg: "bg-zinc-50 dark:bg-zinc-800/90 border-zinc-200 dark:border-zinc-600" },
};

export default function SemanticEdge({
  sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}: SemanticEdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  const [hovered, setHovered] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();

  const intent = data?.intent ?? "General Reference";
  const context = data?.context ?? "";
  const colors = INTENT_COLORS[intent] ?? INTENT_COLORS["General Reference"];
  const isSimilar = intent === "Similar Research";

  const onEnter = () => {
    clearTimeout(leaveTimer.current);
    setHovered(true);
  };
  const onLeave = () => {
    leaveTimer.current = setTimeout(() => setHovered(false), 120);
  };

  return (
    <>
      {/* Visible colored path */}
      <path
        className="react-flow__edge-path"
        d={edgePath}
        fill="none"
        stroke={colors.stroke}
        strokeWidth={isSimilar ? 2 : hovered ? 4 : 2.5}
        strokeOpacity={isSimilar ? 0.45 : hovered ? 1 : 0.85}
        strokeDasharray={isSimilar ? "5,5" : undefined}
        markerEnd={isSimilar ? undefined : `url(#arrow-${intent.replace(/\s/g, "")})`}
        style={{ transition: "stroke-width 0.15s, stroke-opacity 0.15s" }}
      />

      {/* Wide transparent hit area — makes hovering easy */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        style={{ cursor: context ? "pointer" : "default", pointerEvents: "stroke" }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      />

      {/* Label — only visible on hover, no overlap by design */}
      {hovered && !isSimilar && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              zIndex: 10,
            }}
            className="nodrag nopan"
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
          >
            <button
              onClick={() => context && setShowContext(s => !s)}
              className={`px-2.5 py-1 text-[9px] font-semibold border rounded-full shadow-xl backdrop-blur-sm transition-transform ${colors.text} ${colors.bg} ${context ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
            >
              {intent}
              {context && <span className="ml-1 opacity-50">·</span>}
            </button>

            {showContext && context && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 p-3 rounded-xl shadow-2xl z-[200] bg-white dark:bg-[#111113] border border-zinc-200 dark:border-[#2a2a2e]"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-semibold text-zinc-800 dark:text-zinc-300">Citation context</span>
                  <button
                    onClick={e => { e.stopPropagation(); setShowContext(false); }}
                    className="text-zinc-400 hover:text-zinc-900 dark:text-zinc-600 dark:hover:text-zinc-300 text-xs leading-none"
                  >✕</button>
                </div>
                <p className="text-[10px] italic text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  &ldquo;{context}&rdquo;
                </p>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
