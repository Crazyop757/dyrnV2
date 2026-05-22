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

export const VANE_URL = PUBLIC_VANE_URL;
