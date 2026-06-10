"use client";

import { useState } from "react";

type ExtractedColumn = {
  extracted_value: string | null;
  source_passage: string | null;
  source_section: string | null;
  confidence: number;
  pdf_page: number | null;
};

type PaperMatrix = {
  title: string;
  columns: Record<string, ExtractedColumn>;
};

type ExtractMatrixResponse = {
  matrix: Record<string, PaperMatrix>;
};

export default function ExtractionMatrix({ papers }: { papers: any[] }) {
  const [columnsInput, setColumnsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExtractMatrixResponse | null>(null);
  const [activeColumns, setActiveColumns] = useState<string[]>([]);
  const [hoveredCell, setHoveredCell] = useState<{
    cell: ExtractedColumn;
    rect: DOMRect;
  } | null>(null);

  const handleExtract = async () => {
    if (!papers || papers.length === 0) {
      setError("No papers available to extract from.");
      return;
    }

    const cols = columnsInput
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cols.length === 0) {
      setError("Please enter at least one column to extract.");
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);
    setActiveColumns(cols);

    try {
      const res = await fetch("/api/research/extract-matrix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          papers: papers,
          columns: cols,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || "Extraction failed");
      }

      const result: ExtractMatrixResponse = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || "An error occurred during extraction.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCsv = () => {
    if (!data) return;

    const headers = ["Paper Title", ...activeColumns];
    const rows = Object.values(data.matrix).map((paper) => {
      const row = [
        `"${paper.title.replace(/"/g, '""')}"`,
        ...activeColumns.map((col) => {
          const val = paper.columns[col]?.extracted_value || "";
          return `"${val.replace(/"/g, '""')}"`;
        }),
      ];
      return row.join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    navigator.clipboard.writeText(csvContent);
  };

  return (
    <section className="w-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Variable-Extraction Matrix
        </span>
        <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800/60" />
      </div>

      <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#0c0c0e] shadow-xl shadow-black/5 dark:shadow-black/40 mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            value={columnsInput}
            onChange={(e) => setColumnsInput(e.target.value)}
            placeholder="e.g. sample size, dataset used, reported F1 score"
            className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:focus:ring-zinc-400 transition-shadow"
            disabled={loading}
          />
          <button
            onClick={handleExtract}
            disabled={loading || papers?.length === 0}
            className="px-5 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium text-sm rounded-xl hover:bg-zinc-800 dark:hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? "Extracting..." : "Extract Variables"}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Enter natural language headers separated by commas to dynamically extract data from the loaded papers.
        </p>

        {error && (
          <p className="mt-3 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-3 shadow-sm">
            {error}
          </p>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-zinc-600 text-sm mb-4 justify-center py-8">
          <div className="dot-loader">
            <span />
            <span />
            <span />
          </div>
          <span>Analyzing PDFs & generating matrix...</span>
        </div>
      )}

      {data && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800/50 overflow-hidden bg-white dark:bg-[#07070a] shadow-sm">
          <div className="flex justify-end p-2 border-b border-zinc-200 dark:border-zinc-800/50 bg-zinc-50 dark:bg-[#111113]">
            <button
              onClick={handleCopyCsv}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
            >
              Copy as CSV
            </button>
          </div>
          <div className="overflow-x-auto" onScroll={() => setHoveredCell(null)}>
            <table className="w-full text-left text-sm text-zinc-600 dark:text-zinc-300">
              <thead className="bg-zinc-50 dark:bg-[#111113] border-b border-zinc-200 dark:border-zinc-800/50 uppercase tracking-wider text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap min-w-[200px] border-r border-zinc-200 dark:border-zinc-800/50">
                    Paper
                  </th>
                  {activeColumns.map((col) => (
                    <th key={col} className="px-4 py-3 min-w-[150px] border-r border-zinc-200 dark:border-zinc-800/50 last:border-r-0">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                {Object.values(data.matrix).map((paper, i) => {
                  const truncatedTitle =
                    paper.title.length > 60
                      ? paper.title.substring(0, 60) + "..."
                      : paper.title;

                  return (
                    <tr
                      key={i}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 border-r border-zinc-200 dark:border-zinc-800/50">
                        {truncatedTitle}
                      </td>
                      {activeColumns.map((col) => {
                        const cell = paper.columns[col];
                        const isNull = !cell || cell.extracted_value === null;
                        const isLowConfidence = !isNull && cell.confidence < 0.5;

                        return (
                          <td
                            key={col}
                            className={`px-4 py-3 border-r border-zinc-200 dark:border-zinc-800/50 last:border-r-0 ${
                              isLowConfidence ? "opacity-50" : ""
                            }`}
                            onMouseEnter={(e) => {
                              if (!isNull) {
                                setHoveredCell({
                                  cell,
                                  rect: e.currentTarget.getBoundingClientRect(),
                                });
                              }
                            }}
                            onMouseLeave={() => setHoveredCell(null)}
                          >
                            {isNull ? (
                              <span className="text-zinc-400 dark:text-zinc-600">—</span>
                            ) : (
                              <span className="cursor-help border-b border-dotted border-zinc-400 dark:border-zinc-600">
                                {cell.extracted_value}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hoveredCell && (
        <div
          className="fixed z-[100] pointer-events-none w-64 -translate-x-1/2 -translate-y-full mb-2"
          style={{
            left: hoveredCell.rect.left + hoveredCell.rect.width / 2,
            top: hoveredCell.rect.top - 8,
          }}
        >
          <div className="rounded-xl shadow-xl backdrop-blur-xl bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-700 p-3 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 shadow-2xl">
            <div className="font-semibold text-[10px] uppercase tracking-wider mb-1 text-zinc-500">
              {hoveredCell.cell.source_section
                ? `Source: ${hoveredCell.cell.source_section}`
                : "Source Context"}
              {hoveredCell.cell.pdf_page ? ` (Page ${hoveredCell.cell.pdf_page})` : ""}
              <span className="ml-2 text-blue-500">
                {Math.round((hoveredCell.cell.confidence || 0) * 100)}% conf
              </span>
            </div>
            <p className="italic">&ldquo;{hoveredCell.cell.source_passage}&rdquo;</p>
          </div>
          <div className="absolute -bottom-1 left-1/2 -ml-1 h-2 w-2 rotate-45 border-b border-r border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"></div>
        </div>
      )}
    </section>
  );
}
