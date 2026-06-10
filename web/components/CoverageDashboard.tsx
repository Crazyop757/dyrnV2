"use client";

import { useState, useCallback } from "react";
import type { Paper } from "@/lib/types";

type MissingAnchor = {
  paperId: string;
  title: string;
  citationCount: number;
  why_missing: string;
};

type CoverageData = {
  coverage_score: number;
  total_network_nodes: number;
  captured_nodes: number;
  missing_anchors: MissingAnchor[];
  ready_to_write: boolean;
  threshold: number;
};

interface CoverageDashboardProps {
  paperIds: string[];
  onAddPaper?: (paper: Paper) => void;
}

export default function CoverageDashboard({
  paperIds,
  onAddPaper,
}: CoverageDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CoverageData | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const runCoverageCheck = useCallback(async (ids: string[]) => {
    if (!ids || ids.length === 0) {
      setError("No papers loaded to check coverage.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res = await fetch("/api/research/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_ids: ids }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Coverage check failed (${res.status}): ${text || "Unknown error"}`);
      }

      const json = await res.json();
      if (json.error) {
        throw new Error(json.error);
      }
      setData(json);
      setAddedIds(new Set());
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Coverage analysis timed out. The citation network may be too large. Try with fewer papers.");
      } else {
        setError(err.message || "An error occurred during coverage analysis.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCheck = () => runCoverageCheck(paperIds);

  const handleAddPaper = async (anchor: MissingAnchor) => {
    if (addedIds.has(anchor.paperId)) return;
    setAddingId(anchor.paperId);
    setError(null);

    try {
      const res = await fetch(`/api/research/paper/${anchor.paperId}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch paper: ${res.status}`);
      }
      const json = await res.json();
      const paperData = json.paper;

      const paper: Paper = {
        id: paperData.id,
        title: paperData.title || anchor.title,
        authors: paperData.authors || [],
        abstract: paperData.abstract || null,
        year: paperData.year || null,
        venue: paperData.venue || null,
        citation_count: paperData.citation_count || anchor.citationCount,
        reference_count: paperData.reference_count || 0,
        doi: paperData.doi || null,
        arxiv_id: paperData.arxiv_id || null,
        pdf_url: paperData.pdf_url || null,
        url: paperData.url || null,
        tldr: paperData.tldr || null,
        source: "semantic_scholar",
      };

      onAddPaper?.(paper);
      setAddedIds((prev) => new Set(prev).add(anchor.paperId));
    } catch (err: any) {
      setError(`Failed to add paper: ${err.message}`);
    } finally {
      setAddingId(null);
    }
  };

  const getScoreColor = (score: number) => {
    if (score < 0.6) return { text: "text-red-500", stroke: "stroke-red-500" };
    if (score < 0.85) return { text: "text-amber-500", stroke: "stroke-amber-500" };
    return { text: "text-green-500", stroke: "stroke-green-500" };
  };

  const renderSvgCircle = (score: number) => {
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - score * circumference;
    const colors = getScoreColor(score);

    return (
      <div className="relative flex items-center justify-center w-32 h-32">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            strokeWidth="8"
            className="stroke-zinc-200 dark:stroke-zinc-800"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            strokeWidth="8"
            strokeLinecap="round"
            className={`${colors.stroke} transition-all duration-1000 ease-out`}
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: strokeDashoffset,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold ${colors.text}`}>
            {Math.round(score * 100)}%
          </span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mt-0.5">
            Coverage
          </span>
        </div>
      </div>
    );
  };

  return (
    <section className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Coverage Saturation Dashboard
        </span>
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800/60" />
      </div>

      <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#0c0c0e] shadow-xl shadow-black/5 dark:shadow-black/40 mb-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              Check Literature Saturation
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xl">
              Analyzes the citation network of your current papers to determine if you have captured the core foundations of this topic.
            </p>
          </div>
          <button
            onClick={handleCheck}
            disabled={loading || paperIds.length === 0}
            className="px-5 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium text-sm rounded-xl hover:bg-zinc-800 dark:hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center gap-2"
          >
            {loading && (
              <svg className="animate-spin -ml-1 mr-1 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
            {loading ? "Analyzing Network..." : addedIds.size > 0 ? "Re-check Coverage" : "Check Coverage"}
          </button>
        </div>

        {error && (
          <p className="mt-4 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-3 shadow-sm">
            {error}
          </p>
        )}

        {addedIds.size > 0 && !loading && (
          <div className="mt-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 text-blue-700 dark:text-blue-300 text-sm flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{addedIds.size} paper{addedIds.size > 1 ? "s" : ""} added to your library. Click <strong>"Re-check Coverage"</strong> to see your updated score.</span>
          </div>
        )}

        {data && (
          <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800/50 flex flex-col md:flex-row gap-8">
            <div className="flex-shrink-0 flex flex-col items-center">
              {renderSvgCircle(data.coverage_score)}
              <div className="mt-3 text-center text-xs text-zinc-500">
                <p>{data.captured_nodes} / {data.total_network_nodes}</p>
                <p>nodes covered</p>
              </div>
            </div>

            <div className="flex-1">
              {data.ready_to_write && (
                <div className="mb-6 p-4 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 text-green-800 dark:text-green-300">
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-semibold">Ready to Write</span>
                  </div>
                  <p className="text-sm">
                    You've likely captured the core literature. You're ready to write.
                  </p>
                </div>
              )}

              {data.missing_anchors && data.missing_anchors.length > 0 ? (
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
                    Missing Structural Anchors
                  </h4>
                  <div className="space-y-3">
                    {data.missing_anchors.map((anchor) => {
                      const isAdded = addedIds.has(anchor.paperId);
                      const isAdding = addingId === anchor.paperId;

                      return (
                        <div key={anchor.paperId} className={`p-4 rounded-xl border transition-colors group ${isAdded ? "border-green-300 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20" : "border-zinc-200 dark:border-zinc-800/50 bg-white dark:bg-[#111113] hover:border-zinc-300 dark:hover:border-zinc-700"}`}>
                          <div className="flex justify-between items-start gap-4 mb-2">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1 flex-1" title={anchor.title}>
                              {anchor.title}
                            </p>
                            <span className="text-[10px] font-semibold px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-md whitespace-nowrap">
                              {anchor.citationCount} cites
                            </span>
                          </div>
                          <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 italic">
                            {anchor.why_missing}
                          </p>
                          <button
                            onClick={() => handleAddPaper(anchor)}
                            disabled={isAdded || isAdding}
                            className={`text-xs font-medium px-4 py-2 rounded-lg border transition-colors flex items-center gap-2 ${
                              isAdded
                                ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 cursor-default"
                                : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                            } disabled:opacity-60`}
                          >
                            {isAdding && (
                              <svg className="animate-spin h-3 w-3 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            )}
                            {isAdded ? "✓ Added to Library" : isAdding ? "Fetching..." : "Add to Library"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                !data.ready_to_write && (
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800/50 bg-white dark:bg-[#111113] text-sm text-zinc-600 dark:text-zinc-400 text-center">
                    No highly cited missing anchors found in the immediate neighborhood. Keep exploring to increase your coverage score!
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
