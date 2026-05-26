import type { VaneAnswer, VaneProvider } from "./types";

// Browser calls go through our own Next.js proxy (/api/vane/...) to avoid the
// cross-origin block — Vane sends no CORS headers. NEXT_PUBLIC_VANE_URL is
// still exposed so the SetupBanner can show the user where to open Vane's UI.
const PROXY = "/api/vane";
const PUBLIC_VANE_URL = process.env.NEXT_PUBLIC_VANE_URL || "http://localhost:3000";

export type ModelChoice = {
  chat: { providerId: string; key: string };
  embedding: { providerId: string; key: string };
};

// Vane requires structured outputs (response_format: json_schema). Some legacy
// OpenAI models (gpt-3.5-turbo, gpt-4) don't support that and cause the search
// API to crash. Prefer models we know work. Listed in order of preference.
const PREFERRED_CHAT = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4.1",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5",
  "gpt-4-turbo",
];
const PREFERRED_EMBED = [
  "text-embedding-3-small",
  "text-embedding-3-large",
];
const KNOWN_BAD_CHAT = new Set(["gpt-3.5-turbo", "gpt-4"]);

function pickModel(available: { key: string }[], preferred: string[]): string | null {
  const have = new Set(available.map((m) => m.key));
  for (const key of preferred) {
    if (have.has(key)) return key;
  }
  // Fall back to first non-blocklisted model.
  for (const m of available) {
    if (!KNOWN_BAD_CHAT.has(m.key)) return m.key;
  }
  return available[0]?.key ?? null;
}

/**
 * Discover what providers/models are configured in Vane.
 * Returns null if none are set up yet — caller should show the setup banner.
 *
 * Picks a model that's known to work with Vane (skips gpt-3.5-turbo etc. which
 * lack structured-output support and make the search API crash).
 */
export async function discoverModels(): Promise<ModelChoice | null> {
  const r = await fetch(`${PROXY}/providers`);
  if (!r.ok) return null;
  const data: { providers: VaneProvider[] } = await r.json();
  for (const p of data.providers) {
    if (p.chatModels.length === 0 || p.embeddingModels.length === 0) continue;
    const chatKey = pickModel(p.chatModels, PREFERRED_CHAT);
    const embedKey = pickModel(p.embeddingModels, PREFERRED_EMBED);
    if (chatKey && embedKey) {
      return {
        chat: { providerId: p.id, key: chatKey },
        embedding: { providerId: p.id, key: embedKey },
      };
    }
  }
  return null;
}

type SearchArgs = {
  query: string;
  models: ModelChoice;
  sources?: ("web" | "academic" | "discussions")[];
  history?: ChatPair[];
  systemInstructions?: string;
};

export type ChatPair = ["human" | "assistant", string];

export async function search({
  query,
  models,
  sources = ["academic"],
  history,
  systemInstructions,
}: SearchArgs): Promise<VaneAnswer> {
  const body = {
    chatModel: models.chat,
    embeddingModel: models.embedding,
    sources,
    query,
    history: history ?? [],
    optimizationMode: "balanced",
    stream: false,
    ...(systemInstructions ? { systemInstructions } : {}),
  };
  const r = await fetch(`${PROXY}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`vane search ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function analyzeGaps({
  topic,
  papers,
  sections,
  models,
}: {
  topic: string;
  papers: { title: string; year: number | null; authors: string[]; abstract: string | null; citation_count: number; venue: string | null; tldr: string | null; id: string }[];
  sections: Record<string, { limitations: string | null; future_work: string | null; conclusions: string | null }>;
  models: ModelChoice;
}): Promise<VaneAnswer> {
  const paperBlocks = papers
    .map((p, i) => {
      const parts = [
        `### Paper ${i + 1}: ${p.title} (${p.year ?? "n/a"})`,
        `Authors: ${p.authors.join(", ") || "unknown"} | Citations: ${p.citation_count} | Venue: ${p.venue ?? "n/a"}`,
      ];
      if (p.tldr) parts.push(`TLDR: ${p.tldr}`);
      if (p.abstract) parts.push(`Abstract: ${p.abstract}`);
      const sec = sections[p.id];
      if (sec?.limitations) parts.push(`Limitations: ${sec.limitations}`);
      if (sec?.future_work) parts.push(`Future work: ${sec.future_work}`);
      if (sec?.conclusions) parts.push(`Conclusions: ${sec.conclusions}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const systemInstructions = `You are a research intelligence assistant analyzing literature gaps on '${topic}'.

## Papers analyzed
${paperBlocks}

## Analysis instructions

You are not summarizing these papers. You are interrogating them.
For every gap or area you identify, include a search query line formatted exactly as: *Search: "your specific search query here"*

Apply the master constitution to every section:
- Cite specific papers by name when stating a gap
- Label each gap as: GAP / TENSION / EXTENSION / CRITIQUE
- State urgency (high/medium/low) and justify it in one sentence

### Gaps found
Contradictions, population voids, temporal gaps, methodological blindspots. For each: which papers reveal it, what type it is, how urgent, and the *Search:* query.

### Areas to explore
Knowledge voids at intersections of the papers' themes. Directions from future-work or limitations sections, made concrete — not vague suggestions but specific study designs.

### Areas to improve
Repeated limitations across papers. Count how many papers share each one. Suggest a concrete methodological fix, not just an observation.

IMPORTANT: Every gap or area must include:
*Search: "specific search query to verify this gap"*`;

  return search({
    query: `Research gap analysis: ${topic}`,
    models,
    sources: ["academic"],
    systemInstructions,
  });
}

export const VANE_URL = PUBLIC_VANE_URL;
