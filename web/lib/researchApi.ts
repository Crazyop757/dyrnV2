import type { GraphResponse, PapersResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_RESEARCH_API_URL || "http://localhost:8000";

export async function fetchPapers(topic: string, limit = 15): Promise<PapersResponse> {
  const url = `${BASE}/papers?topic=${encodeURIComponent(topic)}&limit=${limit}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`papers ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function fetchGraph(ids: string[]): Promise<GraphResponse> {
  if (ids.length === 0) return { nodes: [], edges: [] };
  const url = `${BASE}/graph?ids=${encodeURIComponent(ids.join(","))}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`graph ${r.status}: ${await r.text()}`);
  return r.json();
}
