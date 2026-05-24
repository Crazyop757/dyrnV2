import type { ExtractResponse, GapVerification, GraphResponse, Paper, PapersResponse } from "./types";

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

export async function fetchExtraction(papers: Paper[]): Promise<ExtractResponse> {
  const withPdf = papers.filter((p) => p.pdf_url);
  if (withPdf.length === 0) return { sections: {} };
  const r = await fetch(`${BASE}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      papers: withPdf.map((p) => ({ id: p.id, pdf_url: p.pdf_url })),
    }),
  });
  if (!r.ok) throw new Error(`extract ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function verifyGap(query: string): Promise<GapVerification> {
  const url = `${BASE}/verify-gap?query=${encodeURIComponent(query)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`verify-gap ${r.status}: ${await r.text()}`);
  return r.json();
}
