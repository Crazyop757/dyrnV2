/**
 * Diagnostic endpoint: checks whether the bundled SearxNG can actually reach
 * the academic search engines from this host's network. Returns only result
 * counts and engine names — no secrets, safe to expose.
 *
 *   GET /api/debug/searx?q=federated+learning
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARXNG_URL = process.env.SEARXNG_API_URL || "http://127.0.0.1:8080";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "federated learning";
  const target = `${SEARXNG_URL}/search?q=${encodeURIComponent(q)}&categories=science&format=json`;
  const t0 = Date.now();
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(30_000) });
    const data = await r.json();
    const results: any[] = data.results || [];
    const perEngine: Record<string, number> = {};
    for (const res of results) {
      for (const e of res.engines || [res.engine]) {
        if (e) perEngine[e] = (perEngine[e] || 0) + 1;
      }
    }
    return Response.json({
      status: r.status,
      tookMs: Date.now() - t0,
      total: results.length,
      perEngine,
      unresponsive: data.unresponsive_engines || [],
    });
  } catch (e: any) {
    return Response.json(
      { error: e?.message || String(e), tookMs: Date.now() - t0 },
      { status: 502 },
    );
  }
}
