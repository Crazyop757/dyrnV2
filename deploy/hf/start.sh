#!/bin/sh
# Supervisor for the single-container Hugging Face Space deployment.
# Web (7860) is the public process — if it dies the container restarts.

echo "[start] launching SearxNG + Vane (internal :3000)..."
(cd /home/vane && PORT=3000 HOSTNAME=127.0.0.1 sh /home/vane/entrypoint.sh) &

echo "[start] launching research-api (internal :8000)..."
(cd /app/research-api && exec /opt/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000) &

# Free Spaces have no persistent disk, so Vane forgets its providers on every
# restart — re-register them from the Space's secret env vars each boot.
echo "[start] launching Vane provider auto-init..."
/bin/sh /app/init_providers.sh &

echo "[start] launching web on :7860..."
cd /app/web
export PORT=7860 HOSTNAME=0.0.0.0
exec node server.js
