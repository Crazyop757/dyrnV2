#!/bin/sh
# Auto-register LLM providers in Vane on every container boot.
# Same logic as scripts/init_vane.sh but against the in-container Vane.

VANE="http://127.0.0.1:3000"

echo "[vane-init] waiting for Vane..."
TRIES=0
until curl -sf "$VANE/api/providers" > /dev/null 2>&1; do
  TRIES=$((TRIES+1))
  if [ "$TRIES" -ge 150 ]; then
    echo "[vane-init] Vane never became ready — giving up"
    exit 1
  fi
  sleep 2
done

if [ -z "$OPENAI_API_KEY" ] && [ -z "$GROQ_API_KEY" ]; then
  echo "[vane-init] Neither OPENAI_API_KEY nor GROQ_API_KEY set — skipping"
  exit 0
fi

PROVIDERS=$(curl -s "$VANE/api/providers")

# add_provider <name> <type> <api_key> [base_url]
add_provider() {
  name="$1"; type="$2"; key="$3"; base_url="$4"
  if [ -z "$key" ]; then
    echo "[vane-init] $name: no API key set — skipping"
    return 0
  fi
  if echo "$PROVIDERS" | grep -q "\"name\":\"$name\""; then
    echo "[vane-init] $name provider already configured"
    return 0
  fi
  if [ -n "$base_url" ]; then
    config="{\"apiKey\":\"$key\",\"baseURL\":\"$base_url\"}"
  else
    config="{\"apiKey\":\"$key\"}"
  fi
  echo "[vane-init] configuring $name provider..."
  curl -sf -X POST "$VANE/api/providers" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"type\":\"$type\",\"config\":$config}" \
    > /dev/null
  echo "[vane-init] $name provider added."
}

add_provider "OpenAI" "openai" "$OPENAI_API_KEY" "https://api.openai.com/v1"
add_provider "Groq"   "groq"   "$GROQ_API_KEY"

echo "[vane-init] done."
