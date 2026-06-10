import type { ExtractResponse, GapAnalysisResponse, GraphResponse, LiteratureReviewResponse, Paper, PapersResponse, SummarizeResponse } from "./types";

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

export async function fetchGapAnalysis(
  topic: string,
  papers: Paper[],
  seedIds: string[],
): Promise<GapAnalysisResponse> {
  const r = await fetch(`${BASE}/gaps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, papers, seed_ids: seedIds }),
  });
  if (!r.ok) throw new Error(`gaps ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function summarizePaper(paper: Paper): Promise<SummarizeResponse> {
  const r = await fetch(`${BASE}/summarize-paper`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper }),
  });
  if (!r.ok) throw new Error(`summarize ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function generateLiteratureReview(
  topic: string,
  papers: Paper[],
): Promise<LiteratureReviewResponse> {
  const r = await fetch(`${BASE}/literature-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, papers }),
  });
  if (!r.ok) throw new Error(`literature-review ${r.status}: ${await r.text()}`);
  return r.json();
}
