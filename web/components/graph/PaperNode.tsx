"use client";

import { Handle, Position } from "@xyflow/react";
import { useTheme } from "next-themes";

type ClusterColor = { border: string; glow: string };

export default function PaperNode({ data }: { data: any }) {
  const title: string = data.label || "(untitled)";
  const year: number | null = data.year;
  const citations: number = data.citation_count || 0;
  const url: string | null = data.url ?? null;
  const tldr: string | null = data.tldr ?? null;
  const cluster: string = data.cluster ?? "";
  const clusterColor: ClusterColor = data.clusterColor ?? { border: "#10b981", glow: "rgba(16,185,129,0.25)" };

  // Scale node size by log(citations) — wider range gives clearer visual
  // contrast between landmark papers and the long tail.
  const size = Math.max(56, Math.min(108, 48 + Math.log2(citations + 1) * 9));
  const shortTitle = title.length > 38 ? title.slice(0, 36) + "…" : title;

  const handleClick = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const { theme } = useTheme();

  return (
    <div className="group relative" style={{ width: size, height: size }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      {/* Main node circle */}
      <div
        onClick={handleClick}
        className="w-full h-full rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110"
        style={{
          background: theme === "dark" ? "linear-gradient(135deg, #18181b 0%, #111113 100%)" : "linear-gradient(135deg, #ffffff 0%, #f4f4f5 100%)",
          border: `2px solid ${clusterColor.border}`,
          boxShadow: `0 0 0 0 transparent`,
          cursor: url ? "pointer" : "default",
          padding: 8,
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 20px ${clusterColor.glow}, 0 0 0 1px ${clusterColor.border}40`;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.boxShadow = "0 0 0 0 transparent";
        }}
      >
        <span
          className="text-[9px] leading-tight text-center font-medium select-none"
          style={{ color: theme === "dark" ? "#d4d4d8" : "#27272a", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {shortTitle}
        </span>
      </div>

      {/* Year badge */}
      {year && (
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] px-1.5 py-0.5 rounded-full whitespace-nowrap shadow-sm"
          style={{ background: theme === "dark" ? "#09090b" : "#ffffff", border: `1px solid ${clusterColor.border}50`, color: clusterColor.border }}
        >
          {year}
        </div>
      )}

      {/* Citation badge top-right */}
      {citations > 0 && (
        <div className="absolute -top-1 -right-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-[7px] text-zinc-600 dark:text-zinc-400 px-1 py-0.5 rounded-full min-w-[18px] text-center shadow-sm">
          {citations >= 1000 ? `${(citations / 1000).toFixed(1)}k` : citations}
        </div>
      )}

      {/* Hover tooltip */}
      <div
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-72 p-3.5 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 space-y-2 bg-white dark:bg-[#0e0e11] border border-zinc-200 dark:border-[#2a2a2e]"
      >
        {/* Cluster pill */}
        {cluster && (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${clusterColor.border}18`, color: clusterColor.border, border: `1px solid ${clusterColor.border}40` }}>
            <span className="w-1 h-1 rounded-full inline-block" style={{ background: clusterColor.border }} />
            {cluster}
          </span>
        )}

        {/* Title */}
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">{title}</p>

        {/* Authors */}
        {data.authors?.length > 0 && (
          <p className="text-[10px] text-zinc-500">
            {data.authors.slice(0, 3).join(", ")}{data.authors.length > 3 ? " et al." : ""}
          </p>
        )}

        {/* TLDR */}
        {tldr && (
          <p className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-relaxed border-l-2 pl-2" style={{ borderColor: `${clusterColor.border}60` }}>
            {tldr}
          </p>
        )}

        {/* Badges row */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {year && <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{year}</span>}
          {citations > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: `${clusterColor.border}18`, color: clusterColor.border }}>
              {citations >= 1000 ? `${(citations / 1000).toFixed(1)}k` : citations} citations
            </span>
          )}
          {url && <span className="text-[9px] text-zinc-500 dark:text-zinc-600 italic ml-auto">click to open ↗</span>}
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
