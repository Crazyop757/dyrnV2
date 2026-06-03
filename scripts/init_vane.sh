#!/bin/sh
set -e

echo "Waiting for Vane to be ready..."
until curl -sf http://vane:3000/api/providers > /dev/null 2>&1; do
  sleep 2
done

if [ -z "$OPENAI_API_KEY" ] && [ -z "$GROQ_API_KEY" ]; then
  echo "Neither OPENAI_API_KEY nor GROQ_API_KEY set — skipping Vane provider setup"
  exit 0
fi

PROVIDERS=$(curl -s http://vane:3000/api/providers)

# add_provider <name> <type> <api_key> [base_url]
# Vane has a native "groq" provider type that auto-loads Groq's model list;
# the generic "openai" type needs an explicit baseURL.
add_provider() {
  name="$1"; type="$2"; key="$3"; base_url="$4"
  if [ -z "$key" ]; then
    echo "$name: no API key set — skipping"
    return 0
  fi
  if echo "$PROVIDERS" | grep -q "\"name\":\"$name\""; then
    echo "$name provider already configured in Vane"
    return 0
  fi
  if [ -n "$base_url" ]; then
    config="{\"apiKey\":\"$key\",\"baseURL\":\"$base_url\"}"
  else
    config="{\"apiKey\":\"$key\"}"
  fi
  echo "Configuring $name provider in Vane..."
  curl -sf -X POST http://vane:3000/api/providers \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"type\":\"$type\",\"config\":$config}" \
    > /dev/null
  echo "$name provider added."
}

add_provider "OpenAI" "openai" "$OPENAI_API_KEY" "https://api.openai.com/v1"
add_provider "Groq"   "groq"   "$GROQ_API_KEY"

echo "Done — Vane provider setup complete, no manual setup needed."
