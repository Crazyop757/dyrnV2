"use client";

import { useState } from "react";
import type { LiteratureReviewResponse, Paper } from "@/lib/types";
import { generateLiteratureReview } from "@/lib/researchApi";
import Markdown from "@/components/Markdown";

type Props = {
  topic: string;
  papers: Paper[];
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
        {children}
      </span>
      <div className="flex-1 h-px bg-zinc-900" />
    </div>
  );
}

export default function LiteratureReview({ topic, papers }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LiteratureReviewResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const enoughPapers = papers.length >= 2;

  const handleGenerate = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await generateLiteratureReview(topic, papers);
      setData(res);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    if (!data) return;
    const blob = new Blob([data.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `literature-review-${topic.slice(0, 40).replace(/\s+/g, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <SectionLabel>Literature review</SectionLabel>

      {!data && !loading && (
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5">
          <p className="text-sm text-zinc-400 leading-relaxed mb-1">
            Draft a publication-ready literature review from these papers.
          </p>
          <p className="text-xs text-zinc-600 leading-relaxed mb-4">
            Synthesized <span className="text-zinc-500">by theme</span> — not paper-by-paper — with
            in-text <span className="text-zinc-500">(Author, Year)</span> citations, a debates section,
            identified gaps, and a references list you can paste straight into your paper.
          </p>
          <button
            onClick={handleGenerate}
            disabled={!enoughPapers}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border border-indigo-500/40 text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-500/60 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2h7l3 3v7H2z" strokeLinejoin="round" />
              <line x1="4.5" y1="6" x2="9.5" y2="6" />
              <line x1="4.5" y1="8.5" x2="9.5" y2="8.5" />
            </svg>
            Generate literature review
          </button>
          {!enoughPapers && (
            <p className="text-[11px] text-zinc-700 mt-2">Need at least 2 papers.</p>
          )}
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5 space-y-3">
          <div className="flex items-center gap-3 text-zinc-500 text-sm">
            <div className="dot-loader"><span /><span /><span /></div>
            <span>Extracting themes and synthesizing across papers…</span>
          </div>
          <div className="space-y-2 pt-1">
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-3 w-5/6" />
            <div className="skeleton h-3 w-4/6" />
          </div>
        </div>
      )}

      {err && (
        <p className="text-red-400 text-sm bg-red-950/20 border border-red-900/30 rounded-xl px-4 py-3">
          {err}
        </p>
      )}

      {data && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-600">
              {data.paper_count} papers · {data.themes.length} themes
            </span>
            <div className="flex-1" />
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-all"
            >
              {copied ? "Copied ✓" : "Copy markdown"}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-all"
            >
              Download .md
            </button>
            <button
              onClick={handleGenerate}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-all"
            >
              Regenerate
            </button>
          </div>

          {/* Theme chips */}
          {data.themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.themes.map((t) => (
                <span
                  key={t.theme}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] border border-zinc-800 bg-zinc-900/40 text-zinc-400"
                  title={t.description}
                >
                  {t.theme}
                  <span className="text-zinc-700">{t.paper_count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Rendered review */}
          <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5 text-sm">
            <Markdown>{data.markdown}</Markdown>
          </div>
        </div>
      )}
    </section>
  );
}
