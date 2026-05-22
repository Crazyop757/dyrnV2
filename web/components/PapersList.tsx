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
      <h2 className="text-xl font-semibold mb-3">Related papers</h2>
      {loading && <p className="text-stone-500">Fetching papers…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!loading && papers.length === 0 && !error && (
        <p className="text-stone-500 text-sm">No papers yet.</p>
      )}
      <ul className="space-y-3">
        {papers.map((p) => {
          const link = paperLink(p);
          return (
            <li key={p.id} className="border border-stone-200 rounded-md p-3">
              <div className="font-medium leading-snug">
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                    {p.title}
                  </a>
                ) : (
                  p.title
                )}
              </div>
              <div className="text-sm text-stone-600 mt-1">
                {p.authors.slice(0, 4).join(", ")}
                {p.authors.length > 4 && " et al."}
                {p.year && ` · ${p.year}`}
                {p.venue && ` · ${p.venue}`}
                {p.citation_count > 0 && ` · ${p.citation_count} citations`}
              </div>
              {p.abstract && (
                <p className="text-sm text-stone-700 mt-2 line-clamp-3">{p.abstract}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
