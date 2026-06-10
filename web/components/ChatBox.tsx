"use client";

import { useRef, useState } from "react";
import { search, type ChatPair, type ModelChoice } from "@/lib/vane";
import type { ChatTurn, Paper, VaneAnswer } from "@/lib/types";
import Markdown from "./Markdown";

type Props = {
  models: ModelChoice;
  overview: VaneAnswer | null;
  papers: Paper[];
  topic: string;
  turns: ChatTurn[];
  onTurnsChange: (next: ChatTurn[]) => void;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
        {children}
      </span>
      <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800/60" />
    </div>
  );
}

function buildContext(overview: VaneAnswer | null, papers: Paper[], topic: string): string {
  const parts: string[] = [];
  parts.push(
    "You are a research intelligence assistant. The user is a " +
    "researcher — either an intern or a professor — asking follow-up " +
    "questions about a specific literature corpus provided below.\n\n" +
    "Every response must follow this structure:\n\n" +
    "[ORIENT] 2-3 sentences max. Frame the concept in research " +
    "context only if needed. Skip if the user is clearly familiar.\n\n" +
    "[LITERATURE POSITION] What do the papers in context actually " +
    "say or fail to say about this? Cite specific papers by name.\n\n" +
    "[RESEARCH MOVE] Label and execute one of:\n" +
    "GAP / TENSION / EXTENSION / CRITIQUE\n\n" +
    "[DIRECTIONS] 2-3 concrete, actionable research questions.\n\n" +
    "Hard rules:\n" +
    "- ORIENT is capped at 3 sentences. No exceptions.\n" +
    "- Every claim must trace to a paper in the provided context.\n" +
    "- Never answer as if the user asked for an explanation.\n" +
    "  Always interpret as: what does this literature say about X?\n" +
    "- No filler phrases. Start responses directly.\n" +
    "- If a concept is absent from the corpus, say so — \n" +
    "  that absence is the finding."
  );
  parts.push(`The user is researching: ${topic}.`);
  if (overview) {
    parts.push(`Earlier on this page, the following concept overview was shown:\n\n${overview.message}`);
  }
  if (papers.length > 0) {
    const lines = papers
      .slice(0, 15)
      .map((p, i) => `${i + 1}. ${p.title}${p.year ? ` (${p.year})` : ""} — ${p.authors.slice(0, 3).join(", ")}`);
    parts.push(`The papers shown to the user are:\n${lines.join("\n")}`);
  }
  parts.push(
    "When answering follow-up questions, prefer information from the overview and papers above. " +
    "If you do additional web searches, integrate them with this context.",
  );
  return parts.join("\n\n");
}

function buildConstitution(topic: string): string {
  return `You are a research intelligence assistant
embedded in an academic literature review tool focused
specifically on the research topic: "${topic}".

Every answer must be grounded in this research context.
Even if the user asks a general concept question, connect
it back to "${topic}" — do not give a generic textbook
definition disconnected from the research session.

Read the user's message and the full conversation history
carefully. Determine the appropriate response style yourself
based on what the user actually needs.

RESPONSE STYLE GUIDE — pick the one that fits:

If the user wants a simple explanation or definition:
  Give a clean 3-5 sentence answer in plain language
  connected to the "${topic}" research context.
  No structure, no gaps or directions.

If the user is asking about the literature, gaps, or methods:
  Use this structure exactly:
  [ORIENT] 2-3 sentences max, research framing only
  [LITERATURE POSITION] cite papers by author and year
  [RESEARCH MOVE] label one: GAP / TENSION / EXTENSION / CRITIQUE
  [DIRECTIONS] 2-3 concrete actionable research questions

If the user wants a recommendation or opinion:
  Lead with a direct answer. Justify briefly from papers.
  No rigid structure. Be opinionated.

If the message is casual or conversational:
  1-3 sentences max. Match the register exactly.
  No structure, no citations, no research framing.

If the user wants a practical methodology answer:
  Direct and actionable. Reference what papers do
  methodologically. Structure only if genuinely complex.

If the user is comparing two or more things:
  Use a table if more than 3 dimensions. Ground comparisons
  in what the papers actually show.

If the user is debugging or troubleshooting something:
  Diagnose first. Ask one clarifying question if ambiguous.

If the user is brainstorming or exploring a hypothesis:
  Engage as a thinking partner. Push the idea forward.
  What would it require? What does the literature suggest?

If the user specifies a format (table, bullets, one liner,
step by step, tldr, etc):
  Follow it exactly. Overrides everything above.

If the message is very short but follows prior conversation:
  Use conversation history to infer intent. Never ask a
  clarifying question if context makes intent clear.

If genuinely unclear with no prior context:
  Ask exactly one short clarifying question. Nothing else.

RULES THAT ALWAYS APPLY:
- Every answer must connect to "${topic}" research context
- Never give a definition disconnected from the research session
- Never use filler phrases
- Never start a response with "I"
- Cite papers by author and year, never by index number
- Match response length to question complexity
- If a concept is absent from the corpus, say so directly

User message: `;
}

export default function ChatBox({ models, overview, papers, topic, turns, onTurnsChange }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    const afterUser: ChatTurn[] = [...turns, { role: "human", text: q }];
    onTurnsChange(afterUser);
    setInput("");

    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const history: ChatPair[] = turns.map((t) => [t.role, t.text]);
      const finalSystemInstructions = buildContext(overview, papers, topic);

      const answer = await search({
        query: buildConstitution(topic) + q,
        models,
        sources: ["academic", "web"],
        history,
        systemInstructions: finalSystemInstructions,
      });
      onTurnsChange([
        ...afterUser,
        { role: "assistant", text: answer.message, sources: answer.sources },
      ]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  return (
    <section>

      {turns.length > 0 && (
        <div className="space-y-3 mb-4">
          {turns.map((t, i) => (
            <div
              key={i}
              className={`rounded-xl px-4 py-3.5 shadow-sm ${
                t.role === "human"
                  ? "bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/40 ml-8"
                  : "bg-white dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50"
              }`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600 mb-2">
                {t.role === "human" ? "You" : "Assistant"}
              </div>
              {t.role === "human" ? (
                <div className="text-sm leading-relaxed text-zinc-900 dark:text-zinc-300 whitespace-pre-wrap">
                  {t.text}
                </div>
              ) : (
                <Markdown>{t.text}</Markdown>
              )}
              {t.role === "assistant" && t.sources && t.sources.length > 0 && (
                <details className="text-xs mt-3">
                  <summary className="cursor-pointer text-zinc-500 dark:text-zinc-600 hover:text-zinc-800 dark:hover:text-zinc-400 transition-colors select-none">
                    {t.sources.length} source{t.sources.length !== 1 ? "s" : ""}
                  </summary>
                  <ol className="mt-2 pl-4 space-y-1 text-zinc-600 dark:text-zinc-500 list-decimal">
                    {t.sources.map((s, j) => (
                      <li key={j}>
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
          ))}

          {busy && (
            <div className="rounded-xl px-4 py-4 bg-white dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800/50 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600 mb-2">
                Assistant
              </div>
              <div className="dot-loader">
                <span /><span /><span />
              </div>
            </div>
          )}

          {error && (
            <p className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl px-4 py-3 shadow-sm">
              {error}
            </p>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); ask(); }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder="Ask anything about the topic, papers, or gaps…"
          className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all shadow-sm"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-zinc-100 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
