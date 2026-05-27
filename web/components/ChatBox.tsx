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

async function classifyIntent(message: string, models: ModelChoice): Promise<string> {
  const res = await fetch("/api/vane/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatModel: models.chat,
      query: `Classify this message into exactly one of these 
modes and reply with ONLY the mode letter, nothing else:

A - wants a simple explanation or definition
B - asking about literature, gaps, or research
C - wants a recommendation or opinion  
D - casual or conversational, very short message
E - methodology or implementation question
F - comparison between two or more things
G - debugging or troubleshooting
H - hypothesis or brainstorming
AMBIGUOUS - fewer than 4 words or completely unclear intent

Message: "${message}"

Reply with a single letter or the word AMBIGUOUS.`,
      systemInstructions: "You are a classifier. Reply with only a single letter A through H or the word AMBIGUOUS. No explanation. No punctuation.",
    })
  });
  const data = await res.json();
  const raw = data.message?.trim().toUpperCase() ?? "AMBIGUOUS";
  if (["A","B","C","D","E","F","G","H"].includes(raw)) return raw;
  return "AMBIGUOUS";
}

const CONSTITUTIONS: Record<string, string> = {
  A: `You are a research assistant. The user wants a simple 
explanation. Give a clean 3-5 sentence answer in plain 
language. No structure, no research framing, no gaps or 
directions. Write like a knowledgeable colleague.
Never start with "I". No filler phrases.
User message: `,

  B: `You are a research intelligence assistant. Apply this 
structure exactly:
[ORIENT] 2-3 sentences max, research framing only
[LITERATURE POSITION] cite papers by author and year, never 
by index number
[RESEARCH MOVE] label one: GAP / TENSION / EXTENSION / CRITIQUE
[DIRECTIONS] 2-3 concrete actionable research questions
No filler. Never start with "I".
Researcher message: `,

  C: `You are a research assistant. Give a direct recommendation 
first, then justify briefly using papers in context. No rigid 
structure. Be opinionated — the user wants a direct answer.
Never start with "I". No filler phrases.
User message: `,

  D: `You are a research assistant. This is a casual message.
Respond in 1-3 sentences maximum. Conversational tone only.
No structure, no bullet points, no sources, no research 
framing. If the user makes a general claim, either briefly 
agree with nuance or gently push back — but in plain 
conversational language, not academic language.
Never start with "I".
User message: `,

  E: `You are a research assistant. Give a direct practical 
answer. Reference what papers in context do methodologically.
Use structure only if the answer is genuinely complex. Lead 
with the actionable answer, justify after.
Never start with "I". No filler phrases.
User message: `,

  F: `You are a research assistant. Structure the comparison 
clearly. Use a table if comparing more than 3 dimensions. 
Ground comparisons in what the papers actually show.
Never start with "I". No filler phrases.
User message: `,

  G: `You are a research assistant. Diagnose first, then fix. 
Ask one clarifying question if the problem is ambiguous. 
Be direct and specific.
Never start with "I". No filler phrases.
User message: `,

  H: `You are a research assistant. Engage with the idea 
seriously as a thinking partner. Push it forward — what 
would it require, what could go wrong, what does the 
literature suggest about feasibility.
Never start with "I". No filler phrases.
User message: `,

  AMBIGUOUS: `You are a research assistant. This message 
is very short or ambiguous, but you have access to the 
conversation history above.

First check: does the conversation history give enough 
context to understand what the user means?

If YES — answer based on that context directly. 
Match the register of the conversation. Be brief.

If NO — ask exactly one short clarifying question 
and output nothing else. Not a question followed by 
an answer. Just the question.

Never output both a clarifying question AND an answer 
in the same response.
User message: `,

  FORMAT: `You are a research assistant. The user has 
specified an exact format or style. Follow it precisely. 
Still cite papers by author and year where relevant.
Never start with "I". No filler phrases.
User message: `,
};

function detectFormatOverride(message: string): boolean {
  const signals = [
    "table", "bullet", "bullet points", "numbered list",
    "one liner", "one line", "step by step", "in depth",
    "short version", "summarize", "formal", "casual",
    "no jargon", "like a beginner", "like a professor",
    "compare side by side", "pros and cons", "tldr"
  ];
  const lower = message.toLowerCase();
  return signals.some(s => lower.includes(s));
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
      
      let mode: string;
      if (detectFormatOverride(q)) {
        mode = "FORMAT";
      } else {
        mode = await classifyIntent(q, models);
      }
      const constitution = CONSTITUTIONS[mode] ?? CONSTITUTIONS["B"];

      const finalSystemInstructions = buildContext(overview, papers, topic);
      console.log("=== EXACT SYSTEM INSTRUCTIONS TO VANE ===");
      console.log(finalSystemInstructions);
      console.log("=========================================");

      const answer = await search({
        query: constitution + q,
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