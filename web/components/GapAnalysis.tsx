"use client";

import { useEffect, useState } from "react";
import { verifyGap } from "@/lib/researchApi";
import type { GapAnalysis as GapAnalysisType, GapVerification } from "@/lib/types";
import Markdown from "./Markdown";

type Props = {
  extracting: boolean;
  analyzing: boolean;
  error: string | null;
  data: GapAnalysisType | null;
  onVerificationsChange: (verifications: GapVerification[]) => void;
};

// Create fresh regex each time to avoid /g lastIndex statefulness bugs.
function searchRe(): RegExp {
  return /\*Search:\s*"([^"]+)"\*/g;
}

function parseSearchQueries(text: string): string[] {
  const queries: string[] = [];
  let match;
  const re = searchRe();
  while ((match = re.exec(text)) !== null) {
    queries.push(match[1]);
  }
  return queries;
}

const BADGE_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-900/60 text-emerald-300 border-emerald-700",
  partial: "bg-amber-900/60 text-amber-300 border-amber-700",
  unlikely: "bg-red-900/60 text-red-300 border-red-700",
};

const BADGE_LABELS: Record<string, string> = {
  confirmed: "Confirmed gap",
  partial: "Partial gap",
  unlikely: "Likely addressed",
};

function VerificationBadge({ v }: { v: GapVerification }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="inline-block ml-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`text-xs px-2 py-0.5 rounded border ${BADGE_STYLES[v.confidence]}`}
      >
        {BADGE_LABELS[v.confidence]} — {v.total} paper{v.total !== 1 ? "s" : ""} found
      </button>
      {expanded && v.papers.length > 0 && (
        <div className="mt-1 ml-2 text-xs text-zinc-400 space-y-0.5">
          {v.papers.map((p, i) => (
            <div key={i}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 underline">
                  {p.title}
                </a>
              ) : (
                <span>{p.title}</span>
              )}
              {p.year && <span className="text-zinc-500"> ({p.year})</span>}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function renderMessageWithBadges(
  text: string,
  verificationMap: Map<string, GapVerification>,
) {
  const parts = text.split(searchRe());
  const elements: (string | JSX.Element)[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) elements.push(<Markdown key={`md-${i}`}>{parts[i]}</Markdown>);
    } else {
      const query = parts[i];
      const v = verificationMap.get(query);
      if (v) {
        elements.push(<VerificationBadge key={i} v={v} />);
      } else {
        elements.push(
          <span key={i} className="text-xs text-zinc-500 italic ml-1">
            (verifying: &quot;{query}&quot;)
          </span>,
        );
      }
    }
  }

  return elements;
}

export default function GapAnalysis({
  extracting,
  analyzing,
  error,
  data,
  onVerificationsChange,
}: Props) {
  const [verificationMap, setVerificationMap] = useState<Map<string, GapVerification>>(new Map());

  useEffect(() => {
    if (!data?.message) return;

    const queries = parseSearchQueries(data.message);
    if (queries.length === 0) return;
    if (data.verifications.length > 0) {
      const map = new Map<string, GapVerification>();
      for (const v of data.verifications) map.set(v.query, v);
      setVerificationMap(map);
      return;
    }

    let cancelled = false;
    const map = new Map<string, GapVerification>();

    (async () => {
      const results = await Promise.allSettled(
        queries.map((q) => verifyGap(q)),
      );
      if (cancelled) return;
      const verifications: GapVerification[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") {
          map.set(r.value.query, r.value);
          verifications.push(r.value);
        }
      }
      setVerificationMap(new Map(map));
      onVerificationsChange(verifications);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.message, onVerificationsChange]);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-3 text-zinc-100">Research gap analysis</h2>

      {extracting && (
        <p className="text-zinc-400">Extracting paper sections...</p>
      )}
      {!extracting && analyzing && (
        <p className="text-zinc-400">Analyzing research gaps...</p>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {data && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="leading-relaxed text-zinc-200">
            {renderMessageWithBadges(data.message, verificationMap)}
          </div>
          {data.sources.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                Sources ({data.sources.length})
              </summary>
              <ol className="mt-2 list-decimal pl-5 space-y-1 text-zinc-300">
                {data.sources.map((s, i) => (
                  <li key={i}>
                    {s.metadata.url ? (
                      <a
                        href={s.metadata.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 underline"
                      >
                        {s.metadata.title || s.metadata.url}
                      </a>
                    ) : (
                      <span>{s.metadata.title || "(source)"}</span>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
