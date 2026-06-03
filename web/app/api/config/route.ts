/**
 * Runtime config endpoint — the frontend's view of the deployment control panel.
 *
 * LLM_PROVIDER is read at request time (not baked into the client bundle), so
 * switching providers is just: edit .env → docker compose up -d web. No rebuild.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const provider = (process.env.LLM_PROVIDER || "openai").trim().toLowerCase();
  return Response.json({
    llmProvider: provider === "groq" ? "groq" : "openai",
  });
}
