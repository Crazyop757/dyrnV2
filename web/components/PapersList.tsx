import type { Paper } from "@/lib/types";

type Props = {
  loading: boolean;
  error: string | null;
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

function Skeleton() {
  return (
    <div className="space-y-2.5">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-4 space-y-2">
          <div className="skeleton h-3.5 w-2/3" />
          <div className="flex gap-1.5">
            <div className="skeleton h-3 w-10 rounded-full" />
            <div className="skeleton h-3 w-20 rounded-full" />
          </div>
          <div className="skeleton h-3 w-1/3" />
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

function paperLink(p: Paper): string | null {
  if (p.pdf_url) return p.pdf_url;
  if (p.doi) return `https://doi.org/${p.doi}`;
  if (p.arxiv_id) return `https://arxiv.org/abs/${p.arxiv_id}`;
  return p.url;
}

export default function PapersList({ loading, error, papers }: Props) {
  return (
    <section>
      <SectionLabel>
        Papers{papers.length > 0 ? ` · ${papers.length}` : ""}
      </SectionLabel>

      {loading && <Skeleton />}

      {error && (
        <p className="text-red-400 text-sm bg-red-950/20 border border-red-900/30 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {!loading && papers.length === 0 && !error && (
        <p className="text-zinc-600 text-sm">No papers found.</p>
      )}

      <ul className="space-y-2.5">
        {papers.map((p) => {
          const link = paperLink(p);
          return (
            <li
              key={p.id}
              className="rounded-xl border border-zinc-800/50 bg-zinc-900/20 p-4 hover:border-zinc-700/60 hover:bg-zinc-900/40 transition-all"
            >
              <div className="font-medium text-sm leading-snug text-zinc-100 mb-2">
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-indigo-300 transition-colors"
                  >
                    {p.title}
                  </a>
                ) : (
                  p.title
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {p.year && (
                  <span className="text-[10px] bg-zinc-800/80 text-zinc-400 px-2 py-0.5 rounded-full">
                    {p.year}
                  </span>
                )}
                {p.venue && (
                  <span className="text-[10px] bg-zinc-800/80 text-zinc-400 px-2 py-0.5 rounded-full max-w-[180px] truncate">
                    {p.venue}
                  </span>
                )}
                {p.citation_count > 0 && (
                  <span className="text-[10px] bg-zinc-800/80 text-zinc-400 px-2 py-0.5 rounded-full">
                    {p.citation_count.toLocaleString()} citations
                  </span>
                )}
              </div>

              <div className="text-xs text-zinc-600 mb-2">
                {p.authors.slice(0, 4).join(", ")}
                {p.authors.length > 4 && " et al."}
              </div>

              {p.abstract && (
                <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">
                  {p.abstract}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
