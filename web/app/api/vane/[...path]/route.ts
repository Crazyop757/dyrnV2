/**
 * Server-side proxy to Vane.
 *
 * Why: Vane (running on a different port) sends no CORS headers, so the browser
 * blocks direct cross-origin calls. We forward calls through our own Next.js
 * server instead — server-to-server has no CORS check.
 *
 *   browser → /api/vane/providers    → (server) http://vane:3000/api/providers
 *   browser → /api/vane/search       → (server) http://vane:3000/api/search
 *
 * Long timeout: /search calls run through SearxNG + an LLM and can take 30-60s.
 * Default Node fetch headers-timeout is 30s; we give it 3 min explicitly and
 * convert timeouts into an explicit 504 so the browser shows an error instead
 * of silently hanging.
 */

const VANE_URL = process.env.VANE_URL || "http://localhost:3000";

// Run on the Node runtime (not Edge) so we have full network primitives.
export const runtime = "nodejs";
// Don't cache, don't time-slice — these are user-driven calls.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function proxy(req: Request, pathParts: string[]) {
  const search = new URL(req.url).search;
  const target = `${VANE_URL}/api/${pathParts.join("/")}${search}`;

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
  const timeout = setTimeout(() => controller.abort(), 180_000); // 3 min
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
    const cause = e?.cause?.code || e?.code || e?.name || "unknown";
    return new Response(
      JSON.stringify({
        error: aborted ? "Upstream timeout" : "Upstream error",
        detail: e?.message || String(e),
        cause,
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
