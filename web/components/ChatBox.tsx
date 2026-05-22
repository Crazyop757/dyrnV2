"use client";

import { useState } from "react";
import { search, type ChatPair, type ModelChoice } from "@/lib/vane";
import type { ChatTurn, Paper, VaneAnswer } from "@/lib/types";

type Props = {
  models: ModelChoice;
  overview: VaneAnswer | null;
  papers: Paper[];
  topic: string;
  turns: ChatTurn[];
  onTurnsChange: (next: ChatTurn[]) => void;
};

function buildContext(overview: VaneAnswer | null, papers: Paper[], topic: string): string {
  const parts: string[] = [];
  parts.push(`The user is researching: ${topic}.`);
  if (overview) {
    parts.push(`Earlier on this page, the following concept overview was shown:\n\n${overview.message}`);
  }
  if (papers.length > 0) {
    const lines = papers
      .slice(0, 15)
      .map(
        (p, i) =>
          `${i + 1}. ${p.title}${p.year ? ` (${p.year})` : ""} — ${p.authors.slice(0, 3).join(", ")}`,
      );
    parts.push(`The papers shown to the user are:\n${lines.join("\n")}`);
  }
  parts.push(
    "When answering follow-up questions, prefer information from the overview and papers above. " +
      "If you do additional web searches, integrate them with this context.",
  );
  return parts.join("\n\n");
}

export default function ChatBox({ models, overview, papers, topic, turns, onTurnsChange }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    const afterUser: ChatTurn[] = [...turns, { role: "human", text: q }];
    onTurnsChange(afterUser);
    setInput("");

    try {
      const history: ChatPair[] = turns.map((t) => [t.role, t.text]);
      const answer = await search({
        query: q,
        models,
        sources: ["academic", "web"],
        history,
        systemInstructions: buildContext(overview, papers, topic),
      });
      onTurnsChange([
        ...afterUser,
        { role: "assistant", text: answer.message, sources: answer.sources },
      ]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-xl font-semibold mb-3 text-zinc-100">Ask follow-ups</h2>
      <div className="space-y-4 mb-4">
        {turns.map((t, i) => (
          <div
            key={i}
            className={`rounded-lg px-4 py-3 ${
              t.role === "human"
                ? "bg-zinc-800/60 border border-zinc-800"
                : "bg-zinc-900/40 border border-zinc-800"
            }`}
          >
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
              {t.role === "human" ? "You" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap leading-relaxed text-zinc-200">{t.text}</div>
            {t.role === "assistant" && t.sources && t.sources.length > 0 && (
              <details className="text-xs mt-2">
                <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
                  Sources ({t.sources.length})
                </summary>
                <ol className="mt-1 list-decimal pl-5 space-y-1 text-zinc-300">
                  {t.sources.map((s, j) => (
                    <li key={j}>
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
        ))}
        {busy && <p className="text-zinc-400 text-sm">Thinking…</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about the topic, papers, or graph…"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-6 py-3 bg-zinc-100 text-zinc-900 rounded-md font-medium disabled:bg-zinc-700 disabled:text-zinc-500 hover:bg-white transition-colors"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
