"use client";

import type { Gap, GapAnalysisResponse, GapType, EvidenceGapMatrix } from "@/lib/types";
import { useState } from "react";

type Props = {
  analyzing: boolean;
  error: string | null;
  data: GapAnalysisResponse | null;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
        {children}
      </span>
      <div className="flex-1 h-px bg-zinc-800/60" />
    </div>
  );
}

function DotLoader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-zinc-600 text-sm">
      <div className="dot-loader"><span /><span /><span /></div>
      <span>{label}</span>
    </div>
  );
}

const TYPE_META: Record<GapType, { label: string; color: string }> = {
  methodological:        { label: "Methodological",  color: "bg-blue-950/60 text-blue-400 border-blue-800/40" },
  knowledge:             { label: "Knowledge",        color: "bg-violet-950/60 text-violet-400 border-violet-800/40" },
  empirical:             { label: "Empirical",        color: "bg-amber-950/60 text-amber-400 border-amber-800/40" },
  population:            { label: "Population",       color: "bg-teal-950/60 text-teal-400 border-teal-800/40" },
  theoretical:           { label: "Theoretical",      color: "bg-indigo-950/60 text-indigo-400 border-indigo-800/40" },
  evidence_contradictory:{ label: "Contradictory",    color: "bg-red-950/60 text-red-400 border-red-800/40" },
  practical:             { label: "Practical",        color: "bg-orange-950/60 text-orange-400 border-orange-800/40" },
};

const CONF_META: Record<string, { label: string; color: string; dot: string }> = {
  confirmed:   { label: "Confirmed gap",      color: "bg-emerald-950/50 text-emerald-400 border-emerald-800/40", dot: "bg-emerald-400" },
  partial:     { label: "Partial gap",        color: "bg-amber-950/50 text-amber-400 border-amber-800/40",   dot: "bg-amber-400" },
  unlikely:    { label: "Likely addressed",   color: "bg-red-950/50 text-red-400 border-red-800/40",         dot: "bg-red-400" },
  incoherent:  { label: "Unclear query",      color: "bg-zinc-800/50 text-zinc-500 border-zinc-700/40",      dot: "bg-zinc-500" },
  error:       { label: "Search error",       color: "bg-zinc-800/50 text-zinc-500 border-zinc-700/40",      dot: "bg-zinc-500" },
  unverified:  { label: "Unverified",         color: "bg-zinc-800/50 text-zinc-500 border-zinc-700/40",      dot: "bg-zinc-500" },
};

function TypeChip({ type }: { type: GapType }) {
  const m = TYPE_META[type] ?? { label: type, color: "bg-zinc-800/50 text-zinc-400 border-zinc-700/40" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${m.color}`}>
      {m.label}
    </span>
  );
}

function VerificationBadge({ gap }: { gap: Gap }) {
  const [open, setOpen] = useState(false);
  const v = gap.verification;
  if (!v) return null;
  const m = CONF_META[v.confidence] ?? CONF_META.unverified;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors ${m.color}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
        {m.label}
        {v.status === "ok" && (
          <span className="opacity-60">
            · {v.relevant_count} paper{v.relevant_count !== 1 ? "s" : ""}
            {" across "}
            {v.indices_searched.join(" / ")}
          </span>
        )}
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5"
        >
          <polyline points="2,4 6,8 10,4" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 pl-3 border-l border-zinc-800 space-y-2">
          {v.queries_used.length > 0 && (
            <div className="text-[10px] text-zinc-600">
              <span className="text-zinc-500 font-medium">Queries used:</span>{" "}
              {v.queries_used.map((q, i) => (
                <span key={i} className="inline-block bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 mr-1 mb-1">
                  {q}
                </span>
              ))}
            </div>
          )}
          {v.sample_papers.length > 0 && (
            <div className="text-[10px] text-zinc-600 space-y-1">
              <span className="text-zinc-500 font-medium">Matching papers:</span>
              {v.sample_papers.map((p, i) => (
                <div key={i} className="ml-2">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline">
                      {p.title}
                    </a>
                  ) : (
                    <span>{p.title}</span>
                  )}
                  {p.year && <span className="text-zinc-700"> ({p.year})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroundingBlock({ gap }: { gap: Gap }) {
  const quotes = gap.grounding ?? [];
  const signal = gap.graph_signal;

  if (quotes.length === 0 && !signal) return null;

  return (
    <div className="mt-3 space-y-2">
      {quotes.slice(0, 2).map((g, i) => (
        <blockquote
          key={i}
          className="border-l-2 border-zinc-700 pl-3 text-xs text-zinc-500 italic leading-relaxed"
        >
          &ldquo;{g.quote}&rdquo;
          <span className="not-italic text-zinc-700 ml-1.5">
            — {g.paper_title}{g.year ? ` (${g.year})` : ""} · {g.section.replace("_", " ")}
          </span>
        </blockquote>
      ))}
      {signal && (
        <div className="flex items-start gap-2 text-xs text-zinc-600">
          <span className="shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full bg-indigo-900/60 border border-indigo-700/40 flex items-center justify-center text-[8px] text-indigo-400 font-bold">G</span>
          <span>
            <span className="text-zinc-500 font-medium capitalize">{signal.type.replace("_", " ")} signal: </span>
            {signal.description}
          </span>
        </div>
      )}
    </div>
  );
}

function GapCard({ gap }: { gap: Gap }) {
  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeChip type={gap.type} />
          {gap.egm_cell && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-indigo-950/60 text-indigo-400 border-indigo-800/40">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="1" width="3.5" height="3.5" rx="0.5"/>
                <rect x="1" y="5.5" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="5.5" width="3.5" height="3.5" rx="0.5" className="opacity-20"/>
              </svg>
              Matrix gap
            </span>
          )}
        </div>
        <span className="text-[10px] text-zinc-700 shrink-0">{gap.id}</span>
      </div>

      <p className="text-sm text-zinc-200 leading-relaxed">{gap.statement}</p>

      {(gap.impact || gap.recommendation) && (
        <div className="space-y-2">
          {gap.impact && (
            <div className="flex items-start gap-2.5">
              <span className="shrink-0 mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 w-[88px] text-center">
                Why it matters
              </span>
              <p className="text-xs text-zinc-400 leading-relaxed">{gap.impact}</p>
            </div>
          )}
          {gap.recommendation && (
            <div className="flex items-start gap-2.5">
              <span className="shrink-0 mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 w-[88px] text-center">
                How to address
              </span>
              <p className="text-xs text-zinc-400 leading-relaxed">{gap.recommendation}</p>
            </div>
          )}
        </div>
      )}

      <GroundingBlock gap={gap} />

      <VerificationBadge gap={gap} />
    </div>
  );
}

function GapMap({ data }: { data: GapAnalysisResponse }) {
  const pairs = data.gap_map?.cluster_pairs ?? [];
  if (pairs.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-3">
        White space between clusters
      </div>
      <div className="space-y-2">
        {pairs.map((p, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-900/30 border border-zinc-800/40 text-xs"
          >
            <div className="w-2 h-2 rounded-full bg-indigo-500/60 shrink-0" />
            <span className="text-zinc-300 font-medium truncate">{p.cluster_a}</span>
            <svg className="w-3 h-3 text-zinc-700 shrink-0" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="6" x2="10" y2="6" />
              <polyline points="7,3 10,6 7,9" />
            </svg>
            <span className="text-zinc-300 font-medium truncate">{p.cluster_b}</span>
            <span className="ml-auto shrink-0 text-zinc-600">
              sim {p.similarity} · {p.citation_count} cit.
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EGMMatrixView({ egm }: { egm: EvidenceGapMatrix }) {
  const [hoveredCell, setHoveredCell] = useState<{ dim1: string; dim2: string } | null>(null);

  if (!egm.matrix.length || !egm.dim1_values.length || !egm.dim2_values.length) return null;

  const cellColor = (count: number) => {
    if (count === 0) return "bg-red-950/60 border-red-900/40 text-red-500";
    if (count === 1) return "bg-amber-950/50 border-amber-900/30 text-amber-500";
    return "bg-emerald-950/40 border-emerald-900/30 text-emerald-500";
  };

  const cellLabel = (count: number) => {
    if (count === 0) return "—";
    return String(count);
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
          Evidence gap matrix
        </span>
        <div className="flex-1 h-px bg-zinc-800/60" />
        <div className="flex items-center gap-3 text-[9px] text-zinc-700">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-950 border border-red-900/40 inline-block"/>Gap</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-950 border border-amber-900/30 inline-block"/>Sparse</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-950 border border-emerald-900/30 inline-block"/>Covered</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left text-zinc-600 font-medium pb-2 pr-3 text-[10px] whitespace-nowrap">
                {egm.dim1_label} ↓ / {egm.dim2_label} →
              </th>
              {egm.dim2_values.map((d2) => (
                <th key={d2} className="text-center text-zinc-500 font-medium pb-2 px-1 text-[10px] whitespace-nowrap max-w-[80px]">
                  <span className="block truncate max-w-[70px]" title={d2}>{d2}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="space-y-1">
            {egm.matrix.map((row) => (
              <tr key={row.dim1_value}>
                <td className="text-zinc-400 font-medium pr-3 py-1 text-[10px] whitespace-nowrap">
                  <span className="block truncate max-w-[100px]" title={row.dim1_value}>{row.dim1_value}</span>
                </td>
                {row.cells.map((cell) => {
                  const isHovered = hoveredCell?.dim1 === row.dim1_value && hoveredCell?.dim2 === cell.dim2_value;
                  return (
                    <td key={cell.dim2_value} className="px-1 py-1 text-center">
                      <div
                        className={`relative mx-auto w-8 h-8 rounded border flex items-center justify-center font-semibold cursor-default transition-all ${cellColor(cell.count)} ${isHovered ? "scale-110 z-10" : ""}`}
                        onMouseEnter={() => setHoveredCell({ dim1: row.dim1_value, dim2: cell.dim2_value })}
                        onMouseLeave={() => setHoveredCell(null)}
                        title={cell.count === 0 ? `Gap: no studies on ${row.dim1_value} × ${cell.dim2_value}` : cell.paper_titles.join("; ")}
                      >
                        {cellLabel(cell.count)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hoveredCell && (() => {
        const row = egm.matrix.find(r => r.dim1_value === hoveredCell.dim1);
        const cell = row?.cells.find(c => c.dim2_value === hoveredCell.dim2);
        if (!cell) return null;
        return (
          <div className="text-[10px] text-zinc-500 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/40">
            <span className="font-medium text-zinc-400">{hoveredCell.dim1} × {hoveredCell.dim2}: </span>
            {cell.count === 0 ? (
              <span className="text-red-400">No papers found — structural gap</span>
            ) : (
              <span>{cell.paper_titles.filter(Boolean).join("; ") || `${cell.count} paper(s)`}</span>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default function GapAnalysis({ analyzing, error, data }: Props) {
  return (
    <section>
      <SectionLabel>Gap analysis</SectionLabel>

      {analyzing && <DotLoader label="Analyzing research gaps…" />}

      {error && (
        <p className="text-red-400 text-sm bg-red-950/20 border border-red-900/30 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {data && data.gaps.length > 0 && (() => {
        const saturated = data.gaps.every(
          (g) => g.verification?.status === "saturated_area"
        );
        return (
          <div className="space-y-3">
            {saturated && (
              <div className="px-4 py-3 rounded-xl bg-amber-950/20 border border-amber-800/30 text-xs text-amber-400/80 leading-relaxed">
                <span className="font-semibold text-amber-300">Well-covered area.</span>{" "}
                This topic has substantial existing literature — no narrow gaps were found.
                Showing the least-saturated areas below. Try a more specific sub-topic for sharper results.
              </div>
            )}
            {data.gaps.map((gap) => (
              <GapCard key={gap.id} gap={gap} />
            ))}
            <GapMap data={data} />
            {data.egm && data.egm.matrix.length > 0 && (
              <EGMMatrixView egm={data.egm} />
            )}
          </div>
        );
      })()}

      {data && data.gaps.length === 0 && !analyzing && (
        <p className="text-zinc-600 text-sm">No gaps identified for this topic.</p>
      )}
    </section>
  );
}
