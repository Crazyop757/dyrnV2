import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = { children: string };

export default function Markdown({ children }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-4 mb-2 text-zinc-100">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold mt-4 mb-2 text-zinc-100">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-3 mb-1 text-zinc-200">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-semibold mt-2 mb-1 text-zinc-200">{children}</h4>
        ),
        p: ({ children }) => (
          <p className="mb-2 leading-relaxed text-zinc-200">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-2 space-y-1 text-zinc-200">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-2 space-y-1 text-zinc-200">{children}</ol>
        ),
        li: ({ children }) => <li className="text-zinc-200">{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold text-zinc-100">{children}</strong>
        ),
        em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-sky-300 underline"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400 italic">
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-zinc-950 border border-zinc-800 rounded-md p-3 my-2 overflow-x-auto">
                <code className="text-sm text-zinc-300">{children}</code>
              </pre>
            );
          }
          return (
            <code className="bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded text-sm">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full text-sm border border-zinc-700">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-zinc-800/60">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-1.5 text-left text-zinc-300 font-medium border-b border-zinc-700">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-1.5 text-zinc-300 border-b border-zinc-800">{children}</td>
        ),
        hr: () => <hr className="border-zinc-700 my-3" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
