import type { VaneAnswer } from "@/lib/types";
import Markdown from "./Markdown";

type Props = {
  loading: boolean;
  error: string | null;
  answer: VaneAnswer | null;
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
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#0c0c0e] p-5 space-y-3 shadow-xl shadow-black/5 dark:shadow-black/40">
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-5/6" />
      <div className="skeleton h-3 w-2/3" />
    </div>
  );
}

export default function ConceptOverview({ loading, error, answer }: Props) {
  return (
    <section>
      <SectionLabel>Overview</SectionLabel>

      {loading && <Skeleton />}

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-3 shadow-sm">
          {error}
        </p>
      )}

      {answer && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-[#0c0c0e] p-5 space-y-4 shadow-xl shadow-black/5 dark:shadow-black/40">
          <Markdown>{answer.message}</Markdown>
          {answer.sources.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-zinc-500 dark:text-zinc-600 hover:text-zinc-800 dark:hover:text-zinc-400 transition-colors select-none">
                {answer.sources.length} source{answer.sources.length !== 1 ? "s" : ""}
              </summary>
              <ol className="mt-2 pl-4 space-y-1.5 text-zinc-600 dark:text-zinc-500 list-decimal">
                {answer.sources.map((s, i) => (
                  <li key={i}>
                    {s.metadata.url ? (
                      <a
                        href={s.metadata.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline-offset-2 hover:underline transition-colors"
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
