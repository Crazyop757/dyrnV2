"use client";

import { useState } from "react";
import type { Paper, PaperSummary } from "@/lib/types";
import { summarizePaper } from "@/lib/researchApi";

type Props = {
  loading: boolean;
  error: string | null;
  papers: Paper[];
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
        {children}
      </span>
      <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2.5">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#0c0c0e] p-5 space-y-2 shadow-xl shadow-black/5 dark:shadow-black/40">
          <div className="skeleton h-3.5 w-2/3" />
          <div className="flex gap-1.5">
            <div className="skeleton h-3 w-10 rounded-full" />
            <div className="skeleton h-3 w-20 rounded-full" />
          </div>
          <div className="skeleton h-3 w-1/3" />
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

function paperLink(p: Paper): string | null {
  if (p.pdf_url) return p.pdf_url;
  if (p.doi) return `https://doi.org/${p.doi}`;
  if (p.arxiv_id) return `https://arxiv.org/abs/${p.arxiv_id}`;
  return p.url;
}

const SUMMARY_FIELDS: { key: keyof PaperSummary; label: string }[] = [
  { key: "objective", label: "Objective" },
  { key: "methods", label: "Methods" },
  { key: "key_findings", label: "Key findings" },
  { key: "limitations", label: "Limitations" },
  { key: "contribution", label: "Contribution" },
];

function SummaryCard({ summary, groundedOnAbstract }: { summary: PaperSummary; groundedOnAbstract: boolean }) {
  return (
    <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/10 p-3.5 space-y-2.5">
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded px-1.5 py-0.5">
          TL;DR
        </span>
        <p className="text-xs text-zinc-700 dark:text-zinc-200 leading-relaxed">{summary.tldr}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 pt-1">
        {SUMMARY_FIELDS.map(({ key, label }) => {
          const val = summary[key];
          const notStated = /not stated/i.test(val || "");
          return (
            <div key={key}>
              <div className="text-[9px] uppercase tracking-widest text-zinc-500 dark:text-zinc-600 mb-0.5">{label}</div>
              <p className={`text-[11px] leading-relaxed ${notStated ? "text-zinc-500 dark:text-zinc-700 italic" : "text-zinc-600 dark:text-zinc-400"}`}>
                {val}
              </p>
            </div>
          );
        })}
      </div>
      {groundedOnAbstract && (
        <p className="text-[9px] text-zinc-500 dark:text-zinc-700 pt-1 border-t border-zinc-200 dark:border-zinc-800/50">
          Generated from the abstract only — methods and limitations may be incomplete.
        </p>
      )}
    </div>
  );
}

function PaperCard({ paper }: { paper: Paper }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<PaperSummary | null>(null);
  const [grounded, setGrounded] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const link = paperLink(paper);

  const handleSummarize = async () => {
    if (summary) {
      setOpen((o) => !o);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await summarizePaper(paper);
      setSummary(res.summary);
      setGrounded(res.grounded_on === "abstract");
      setOpen(true);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#0c0c0e] p-5 hover:border-zinc-300 dark:hover:border-zinc-700/60 transition-all shadow-xl shadow-black/5 dark:shadow-black/40">
      <div className="font-medium text-sm leading-snug text-zinc-900 dark:text-zinc-100 mb-2">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            {paper.title}
          </a>
        ) : (
          paper.title
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {paper.year && (
          <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">{paper.year}</span>
        )}
        {paper.venue && (
          <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full max-w-[180px] truncate">
            {paper.venue}
          </span>
        )}
        {paper.citation_count > 0 && (
          <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">
            {paper.citation_count.toLocaleString()} citations
          </span>
        )}
      </div>

      <div className="text-xs text-zinc-500 dark:text-zinc-600 mb-2">
        {paper.authors.slice(0, 4).join(", ")}
        {paper.authors.length > 4 && " et al."}
      </div>

      {paper.abstract && (
        <p className="text-xs text-zinc-600 dark:text-zinc-500 leading-relaxed line-clamp-3">{paper.abstract}</p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleSummarize}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/5 hover:bg-blue-100 dark:hover:bg-blue-500/15 hover:border-blue-300 dark:hover:border-blue-500/50 transition-all disabled:opacity-50"
        >
          {loading ? (
            <>
              <span className="dot-loader scale-75 origin-left"><span /><span /><span /></span>
              Summarizing…
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
                <line x1="2.5" y1="3.5" x2="11.5" y2="3.5" />
                <line x1="2.5" y1="7" x2="11.5" y2="7" />
                <line x1="2.5" y1="10.5" x2="8" y2="10.5" />
              </svg>
              {summary ? (open ? "Hide summary" : "Show summary") : "Summarize"}
            </>
          )}
        </button>
      </div>

      {err && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{err}</p>}
      {open && summary && <SummaryCard summary={summary} groundedOnAbstract={grounded} />}
    </li>
  );
}

export default function PapersList({ loading, error, papers }: Props) {
  return (
    <section>
      <SectionLabel>
        Papers{papers.length > 0 ? ` · ${papers.length}` : ""}
      </SectionLabel>

      {loading && <Skeleton />}

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-3 shadow-sm">
          {error}
        </p>
      )}

      {!loading && papers.length === 0 && !error && (
        <p className="text-zinc-500 dark:text-zinc-600 text-sm">No papers found.</p>
      )}

      <ul className="space-y-2.5">
        {papers.map((p) => (
          <PaperCard key={p.id} paper={p} />
        ))}
      </ul>
    </section>
  );
}
