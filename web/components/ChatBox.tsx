"use client";

import { useState } from "react";
import { search, type ChatPair, type ModelChoice } from "@/lib/vane";
import type { ChatTurn, Paper, VaneAnswer } from "@/lib/types";

type Props = {
  models: ModelChoice;
  overview: VaneAnswer | null;
  papers: Paper[];
  topic: string;
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

export default function ChatBox({ models, overview, papers, topic }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    const newTurns: ChatTurn[] = [...turns, { role: "human", text: q }];
    setTurns(newTurns);
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
      setTurns([...newTurns, { role: "assistant", text: answer.message, sources: answer.sources }]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">Ask follow-ups</h2>
      <div className="space-y-3 mb-3">
        {turns.map((t, i) => (
          <div key={i} className={t.role === "human" ? "text-stone-900" : "text-stone-700"}>
            <div className="text-xs uppercase tracking-wide text-stone-500 mb-1">
              {t.role === "human" ? "You" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{t.text}</div>
            {t.role === "assistant" && t.sources && t.sources.length > 0 && (
              <details className="text-xs mt-1">
                <summary className="cursor-pointer text-stone-500">
                  Sources ({t.sources.length})
                </summary>
                <ol className="mt-1 list-decimal pl-5 space-y-1">
                  {t.sources.map((s, j) => (
                    <li key={j}>
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
        ))}
        {busy && <p className="text-stone-500 text-sm">Thinking…</p>}
        {error && <p className="text-red-600 text-sm">{error}</p>}
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
          className="flex-1 border border-stone-300 rounded-md px-4 py-3"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-6 py-3 bg-stone-900 text-white rounded-md font-medium disabled:bg-stone-400"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
