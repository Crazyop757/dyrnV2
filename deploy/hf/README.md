---
title: Research MVP
emoji: 🔬
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Research MVP

A single-page research assistant: concept overview, related papers from 4
academic sources, a relations graph, gap analysis, and follow-up chat.

## Control panel (Space settings)

| Setting | Where | What it does |
|---------|-------|--------------|
| `LLM_PROVIDER` | Variables | Master switch: `groq` (free, day-to-day) or `openai` (paid, important demos). Change it → Space restarts (~1 min) → done. |
| `OPENAI_API_KEY` | Secrets | OpenAI key (also used for embeddings in both modes) |
| `GROQ_API_KEY` | Secrets | Groq key (free tier) |
| `SEMANTIC_SCHOLAR_API_KEY` etc. | Secrets | Optional paper-source keys for better rate limits |

All three services (Next.js web, FastAPI research-api, Vane+SearxNG) run in
this one container. Only the web app's port is public — Vane and the research
API are reached through same-origin server-side proxies.
