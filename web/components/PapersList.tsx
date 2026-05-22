import type { Paper } from "@/lib/types";

type Props = {
  loading: boolean;
  error: string | null;
  papers: Paper[];
};

function paperLink(p: Paper): string | null {
  if (p.pdf_url) return p.pdf_url;
  if (p.doi) return `https://doi.org/${p.doi}`;
  if (p.arxiv_id) return `https://arxiv.org/abs/${p.arxiv_id}`;
  return p.url;
}

export default function PapersList({ loading, error, papers }: Props) {
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3 text-zinc-100">Related papers</h2>
      {loading && <p className="text-zinc-400">Fetching papers…</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!loading && papers.length === 0 && !error && (
        <p className="text-zinc-500 text-sm">No papers yet.</p>
      )}
      <ul className="space-y-3">
        {papers.map((p) => {
          const link = paperLink(p);
          return (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 hover:border-zinc-700 transition-colors"
            >
              <div className="font-medium leading-snug text-zinc-100">
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
                  >
                    {p.title}
                  </a>
                ) : (
                  p.title
                )}
              </div>
              <div className="text-sm text-zinc-400 mt-1">
                {p.authors.slice(0, 4).join(", ")}
                {p.authors.length > 4 && " et al."}
                {p.year && ` · ${p.year}`}
                {p.venue && ` · ${p.venue}`}
                {p.citation_count > 0 && ` · ${p.citation_count} citations`}
              </div>
              {p.abstract && (
                <p className="text-sm text-zinc-300 mt-2 line-clamp-3">{p.abstract}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
