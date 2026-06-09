"use client";

import { useState } from "react";
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
      
      const finalSystemInstructions = buildContext(overview, papers, topic);
      console.log("=== EXACT SYSTEM INSTRUCTIONS TO VANE ===");
      console.log(finalSystemInstructions);
      console.log("=========================================");

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
            {t.role === "human" ? (
              <div className="whitespace-pre-wrap leading-relaxed text-zinc-200">{t.text}</div>
            ) : (
              <Markdown>{t.text}</Markdown>
            )}
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