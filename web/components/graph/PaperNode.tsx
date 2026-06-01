"use client";

import { Handle, Position } from "@xyflow/react";

export default function PaperNode({ data }: { data: any }) {
  const title = data.label || "(untitled)";
  const shortTitle = title.length > 40 ? title.slice(0, 38) + "…" : title;
  const year = data.year;
  const citations = data.citation_count || 0;

  // Size the node based on citation count
  const size = Math.max(60, Math.min(90, 50 + Math.log2(citations + 1) * 8));

  return (
    <div
      className="group relative"
      style={{ width: size, height: size }}
    >
      <Handle type="target" position={Position.Left} className="!bg-emerald-400 !w-2 !h-2 !border-zinc-900 !border-2" />

      {/* Main circle node */}
      <div
        className="w-full h-full rounded-full border-2 border-zinc-600 bg-zinc-800 flex items-center justify-center cursor-pointer transition-all duration-200 hover:border-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-110"
        style={{ padding: 8 }}
      >
        <span className="text-[9px] leading-tight text-center text-zinc-300 font-medium line-clamp-3 select-none">
          {shortTitle}
        </span>
      </div>

      {/* Year badge */}
      {year && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 text-[8px] text-zinc-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
          {year}
        </div>
      )}

      {/* Hover tooltip with full details */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-56 p-3 bg-zinc-900/95 backdrop-blur border border-zinc-700 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        <p className="text-xs font-semibold text-zinc-100 leading-tight mb-1">{title}</p>
        <p className="text-[10px] text-zinc-400">
          {year ? `${year} · ` : ""}
          {data.authors?.join(", ")}
        </p>
        {citations > 0 && (
          <p className="text-[10px] text-emerald-400 mt-1">{citations} citations</p>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!bg-emerald-400 !w-2 !h-2 !border-zinc-900 !border-2" />
    </div>
  );
}
