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
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
        {children}
      </span>
      <div className="flex-1 h-px bg-zinc-900" />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5 space-y-3">
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
        <p className="text-red-400 text-sm bg-red-950/20 border border-red-900/30 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {answer && (
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-5 space-y-4">
          <Markdown>{answer.message}</Markdown>
          {answer.sources.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-zinc-600 hover:text-zinc-400 transition-colors select-none">
                {answer.sources.length} source{answer.sources.length !== 1 ? "s" : ""}
              </summary>
              <ol className="mt-2 pl-4 space-y-1.5 text-zinc-500 list-decimal">
                {answer.sources.map((s, i) => (
                  <li key={i}>
                    {s.metadata.url ? (
                      <a
                        href={s.metadata.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline transition-colors"
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
