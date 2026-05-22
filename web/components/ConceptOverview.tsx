import type { VaneAnswer } from "@/lib/types";

type Props = {
  loading: boolean;
  error: string | null;
  answer: VaneAnswer | null;
};

export default function ConceptOverview({ loading, error, answer }: Props) {
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3 text-zinc-100">Concept overview</h2>
      {loading && <p className="text-zinc-400">Reading sources and writing a summary…</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {answer && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="whitespace-pre-wrap leading-relaxed text-zinc-200">{answer.message}</div>
          {answer.sources.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                Sources ({answer.sources.length})
              </summary>
              <ol className="mt-2 list-decimal pl-5 space-y-1 text-zinc-300">
                {answer.sources.map((s, i) => (
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
