import type { VaneAnswer } from "@/lib/types";

type Props = {
  loading: boolean;
  error: string | null;
  answer: VaneAnswer | null;
};

export default function ConceptOverview({ loading, error, answer }: Props) {
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">Concept overview</h2>
      {loading && <p className="text-stone-500">Reading sources and writing a summary…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {answer && (
        <div className="space-y-3">
          <div className="whitespace-pre-wrap leading-relaxed">{answer.message}</div>
          {answer.sources.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-stone-600">
                Sources ({answer.sources.length})
              </summary>
              <ol className="mt-2 list-decimal pl-5 space-y-1">
                {answer.sources.map((s, i) => (
                  <li key={i}>
                    {s.metadata.url ? (
                      <a
                        href={s.metadata.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
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
