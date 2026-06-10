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



// Run on the Node runtime (not Edge) so we have full network primitives.
export const runtime = "nodejs";
// Don't cache, don't time-slice — these are user-driven calls.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function proxy(req: Request, pathParts: string[]) {
  const VANE_URL = process.env.VANE_URL || "http://localhost:3000";
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
  // 4.5 min — Vane searches on small free-tier hardware can exceed 3 min.
  const timeout = setTimeout(() => controller.abort(), 270_000);
  init.signal = controller.signal;

  try {
    const upstream = await fetch(target, init);
    clearTimeout(timeout);
    let body = await upstream.text();
    // SECURITY: Vane's /providers response includes each provider's raw API
    // key in `config`. The frontend only needs id/name/model lists, so strip
    // the config before the response leaves our server.
    if (pathParts[0] === "providers" && upstream.ok) {
      try {
        const data = JSON.parse(body);
        const strip = (p: any) => (p && typeof p === "object" ? { ...p, config: undefined, hash: undefined } : p);
        if (Array.isArray(data?.providers)) data.providers = data.providers.map(strip);
        if (data?.provider) data.provider = strip(data.provider);
        body = JSON.stringify(data);
      } catch {
        // Non-JSON body — pass through unchanged.
      }
    }
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
  // Only /search needs POST from the browser. Provider management goes
  // directly to Vane from vane-init — don't expose it to the public internet.
  if (path[0] !== "search") {
    return new Response(JSON.stringify({ error: "Not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return proxy(req, path);
};
