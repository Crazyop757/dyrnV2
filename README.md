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
4. **One-time Vane setup:** open http://localhost:3002 in your browser. Vane will show a setup screen; add your OpenAI API key there and pick `gpt-4o-mini` as the chat model and `text-embedding-3-large` as the embedding model. (This step is what stores your key — we don't put it in `.env` because Vane manages provider configuration internally.)
5. Open http://localhost:3001 — this is the research MVP.

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
