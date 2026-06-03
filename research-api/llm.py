"""
Central LLM provider switch.

Every LLM call in this service goes through get_llm(). The active provider is
controlled from ONE place — the root .env file:

  LLM_PROVIDER     "openai" or "groq"  — the master switch
  OPENAI_API_KEY / OPENAI_MODEL        — paid provider (default: gpt-4o-mini)
  GROQ_API_KEY   / GROQ_MODEL          — free provider (default: llama-3.3-70b-versatile)

Groq exposes an OpenAI-compatible API, so both providers use the same client.
If the selected provider's key is missing we fall back to the other one so a
misconfigured switch degrades gracefully instead of disabling gap analysis.
"""

from __future__ import annotations

import logging
import os

from openai import AsyncOpenAI

log = logging.getLogger(__name__)

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"


def get_llm() -> tuple[AsyncOpenAI | None, str]:
    """Return (client, model) for the active provider, or (None, "") if no key is set."""
    provider = (os.getenv("LLM_PROVIDER") or "openai").strip().lower()
    openai_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    groq_key = (os.getenv("GROQ_API_KEY") or "").strip()

    # Graceful fallback when the selected provider has no key.
    if provider == "groq" and not groq_key and openai_key:
        log.warning("LLM_PROVIDER=groq but GROQ_API_KEY is empty — falling back to OpenAI")
        provider = "openai"
    elif provider != "groq" and not openai_key and groq_key:
        log.warning("LLM_PROVIDER=%s but OPENAI_API_KEY is empty — falling back to Groq", provider)
        provider = "groq"

    if provider == "groq" and groq_key:
        model = (os.getenv("GROQ_MODEL") or "").strip() or DEFAULT_GROQ_MODEL
        return AsyncOpenAI(api_key=groq_key, base_url=GROQ_BASE_URL), model
    if openai_key:
        model = (os.getenv("OPENAI_MODEL") or "").strip() or DEFAULT_OPENAI_MODEL
        return AsyncOpenAI(api_key=openai_key), model
    return None, ""
