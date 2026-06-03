# Single-container image for Hugging Face Spaces (free tier).
#
# Runs all three services in one container:
#   - Vane + bundled SearxNG  (127.0.0.1:3000 / :8080 — internal only)
#   - research-api (FastAPI)  (127.0.0.1:8000 — internal only)
#   - Next.js web             (0.0.0.0:7860 — the ONLY public port)
#
# The browser reaches Vane and research-api through the web app's
# same-origin proxies (/api/vane, /api/research), so Vane — whose API
# exposes raw LLM keys — is never reachable from the internet.

# ---------- Stage 1: build the Next.js web app ----------
FROM node:20-slim AS web-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
# All browser calls go through same-origin proxies — no public backend URLs.
ENV NEXT_PUBLIC_VANE_URL="" \
    NEXT_PUBLIC_RESEARCH_API_URL=/api/research
RUN npm run build

# ---------- Stage 2: Vane base + research-api + web ----------
FROM itzcrazykns1337/vane:latest

# Python runtime for research-api (Vane image is Debian bookworm)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

COPY research-api/requirements.txt /app/research-api/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /app/research-api/requirements.txt
COPY research-api/ /app/research-api/

# Next.js standalone build
COPY --from=web-builder /web/public /app/web/public
COPY --from=web-builder /web/.next/standalone /app/web/
COPY --from=web-builder /web/.next/static /app/web/.next/static

COPY start.sh init_providers.sh /app/
RUN chmod +x /app/start.sh /app/init_providers.sh

# Server-side URLs for the web app's proxy routes (all in-container).
ENV VANE_URL=http://127.0.0.1:3000 \
    RESEARCH_API_URL=http://127.0.0.1:8000

EXPOSE 7860
ENTRYPOINT []
CMD ["/bin/sh", "/app/start.sh"]
