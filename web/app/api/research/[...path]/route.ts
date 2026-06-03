/**
 * Server-side proxy to the research API.
 *
 * Why: in single-container deployments (e.g. Hugging Face Spaces) only the
 * web app's port is reachable from the internet, so the browser cannot call
 * research-api directly. Build the web image with
 * NEXT_PUBLIC_RESEARCH_API_URL=/api/research and every researchApi.ts call
 * lands here and is forwarded server-side:
 *
 *   browser → /api/research/papers?...     → (server) http://127.0.0.1:8000/papers?...
 *   browser → /api/research/gap-analysis   → (server) http://127.0.0.1:8000/gap-analysis
 *
 * The docker-compose deployment is unaffected — there the browser still calls
 * research-api directly on its public port.
 *
 * Long timeout: /gap-analysis runs PDF extraction + several LLM calls and can
 * take minutes.
 */

const RESEARCH_API_URL = process.env.RESEARCH_API_URL || "http://localhost:8000";

// Run on the Node runtime (not Edge) so we have full network primitives.
export const runtime = "nodejs";
// Don't cache, don't time-slice — these are user-driven calls.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function proxy(req: Request, pathParts: string[]) {
  const search = new URL(req.url).search;
  const target = `${RESEARCH_API_URL}/${pathParts.join("/")}${search}`;

  const init: RequestInit & { duplex?: string } = {
    method: req.method,
    headers: {
      "Content-Type": req.headers.get("content-type") || "application/json",
    },
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 280_000);
  init.signal = controller.signal;

  try {
    const upstream = await fetch(target, init);
    clearTimeout(timeout);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (e: any) {
    clearTimeout(timeout);
    const aborted = e?.name === "AbortError";
    return new Response(
      JSON.stringify({
        error: aborted ? "Upstream timeout" : "Upstream error",
        detail: e?.message || String(e),
      }),
      {
        status: aborted ? 504 : 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export const GET = async (req: Request, ctx: Ctx) => {
  const { path } = await ctx.params;
  return proxy(req, path);
};
export const POST = async (req: Request, ctx: Ctx) => {
  const { path } = await ctx.params;
  return proxy(req, path);
};
