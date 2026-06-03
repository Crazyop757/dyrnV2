# Research MVP

A single-page research assistant. Enter a topic, and the page shows:
1. A short concept overview (what the topic is, with cited sources)
2. A list of related papers with direct links
3. A 2D graph of how the papers relate to each other
4. A chat box for follow-up questions (uses the above as context)

Built by integrating three open-source projects:
- **[Perplexica / Vane](https://github.com/ItzCrazyKns/Perplexica)** — provides the concept overview and the follow-up chat
- **[Academix](https://github.com/xingyulu23/Academix)** — its source-clients code (OpenAlex, Semantic Scholar, arXiv) is reused for the paper list
- **[SpiderPDF](https://github.com/overlorde/spiderpdf)** — its graph-building logic (bibliographic coupling + co-citation) is reused for the relations graph

## How to run it (local, Docker)

1. Install Docker + Docker Compose.
2. Copy the env template:
   ```
   cp .env.example .env
   ```
   (You can leave it empty for the first run — keys are optional.)
3. Bring everything up:
   ```
   docker compose up --build
   ```
4. Open http://localhost:3001 — this is the research MVP. (Vane providers are configured automatically from `.env` by the `vane-init` service.)

## LLM control panel (`.env`)

All LLM switches live in one place — the root `.env`:

| Variable | What it controls |
|----------|------------------|
| `LLM_PROVIDER` | Master switch: `openai` (paid, for important demos) or `groq` (free tier, day-to-day) |
| `OPENAI_API_KEY` / `GROQ_API_KEY` | Keys for both providers — keep both filled so switching is one-line |
| `OPENAI_MODEL` / `GROQ_MODEL` | Optional model overrides (defaults: `gpt-4o-mini` / `llama-3.3-70b-versatile`) |

To switch providers on a running deployment:

```
# edit LLM_PROVIDER in .env, then:
docker compose up -d research-api web
```

No rebuild needed — `research-api` reads the env at startup and the web frontend
reads it at runtime via `/api/config`. Note: embeddings always come from OpenAI
(Groq has no embedding models); embedding cost is negligible.

## Deploying to Hugging Face Spaces (free)

The live deployment runs as a single Docker Space: https://huggingface.co/spaces/techbriny07/research-mvp
(app: https://techbriny07-research-mvp.hf.space). All three services run in one
container — see `deploy/hf/`. Only the web port is public; Vane and the
research API are reached through same-origin proxies (`/api/vane`, `/api/research`).

**Control panel** = the Space's Settings page (Variables & secrets):
- `LLM_PROVIDER` variable: `groq` (free) ⇄ `openai` (paid) — change it, the
  Space restarts (~1 min), done.
- Keys live in Space secrets.

**To deploy code changes:**
```
rm -rf ~/hf-stage && mkdir ~/hf-stage
cp deploy/hf/Dockerfile deploy/hf/start.sh deploy/hf/init_providers.sh deploy/hf/README.md deploy/hf/.dockerignore ~/hf-stage/
rsync -a --exclude node_modules --exclude .next web ~/hf-stage/
rsync -a --exclude __pycache__ research-api ~/hf-stage/
HF_TOKEN=<token> hf upload <user>/research-mvp ~/hf-stage . --repo-type=space
```

Note: free Spaces sleep after ~48h without traffic; the first visit after that
takes ~1 min to wake. Open the link yourself before sharing it for a demo.

## Deploying on a server

The browser calls the research API (8000) directly, so set its public URL in
`.env` and rebuild the web image once:

```
NEXT_PUBLIC_RESEARCH_API_URL=http://<server-ip-or-domain>:8000
```
```
docker compose up -d --build
```

Open ports **3001 and 8000** in the server firewall (e.g. the Azure NSG).
Do NOT open 3002 — Vane's UI/API exposes the raw LLM API keys, so it is bound
to 127.0.0.1 on the host. Reach it via an SSH tunnel if you ever need its UI:
`ssh -L 3002:localhost:3002 <vm>`. (The web app's `/api/vane` proxy also
redacts provider keys before responses leave the server.)

## How to use it

- Type a research topic in the box (e.g. "graph neural networks for drug discovery") and press Search.
- Wait ~10 seconds. The four sections populate:
  - **Concept overview** — a short summary with source links
  - **Related papers** — ~15 papers with title, authors, year, link
  - **Relations graph** — interactive 2D graph; click a node to highlight
  - **Ask follow-ups** — type a question; the answer is grounded in the above

## Services

| Service        | Port | What it does                                                  |
|----------------|------|---------------------------------------------------------------|
| `vane`         | 3002 | Perplexica/Vane: AI search + chat (its own UI also lives here)|
| `research-api` | 8000 | Our FastAPI service: `/papers` and `/graph` endpoints         |
| `web`          | 3001 | Our Next.js single-page UI                                    |

## Project layout

```
tp/
├── docker-compose.yml
├── .env.example
├── README.md
├── research-api/        # Python/FastAPI — paper list + graph
└── web/                 # Next.js — the single-page UI
```

## Status

This is an MVP. Roadmap after the core flow works end-to-end:
- Research-gap finder (button under the graph)
- Save/load sessions
- Filter the graph by year / citation count
