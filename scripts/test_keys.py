"""
Quick smoke test for the API keys in /home/azureuser/mojj/tp/.env.

Hits each upstream once with a tiny query and prints PASS / FAIL + the first
result so you can see the keys are actually being honored (not silently falling
back to the anonymous tier).

Run:
  python3 scripts/test_keys.py
"""

import os
import sys
from pathlib import Path

import httpx

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def status(label: str, ok: bool, detail: str) -> None:
    tag = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    print(f"[{tag}] {label:18}  {detail}")


def test_semantic_scholar(key: str) -> None:
    if not key:
        status("Semantic Scholar", False, "no key set")
        return
    try:
        r = httpx.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            params={"query": "graph neural networks", "limit": 1, "fields": "paperId,title,year"},
            headers={"x-api-key": key, "User-Agent": "research-mvp-test/0.1"},
            timeout=20.0,
        )
    except httpx.HTTPError as e:
        status("Semantic Scholar", False, f"network: {e}")
        return
    if r.status_code == 200:
        data = r.json().get("data") or []
        title = (data[0] or {}).get("title", "(no result)") if data else "(no result)"
        status("Semantic Scholar", True, f"200 OK — got '{title[:60]}'")
    else:
        status("Semantic Scholar", False, f"{r.status_code}: {r.text[:120]}")


def test_openalex(email: str) -> None:
    if not email:
        status("OpenAlex", False, "no email set")
        return
    try:
        r = httpx.get(
            "https://api.openalex.org/works",
            params={"search": "graph neural networks", "per_page": 1, "mailto": email},
            headers={"User-Agent": f"research-mvp-test/0.1 (mailto:{email})"},
            timeout=20.0,
        )
    except httpx.HTTPError as e:
        status("OpenAlex", False, f"network: {e}")
        return
    if r.status_code == 200:
        results = r.json().get("results") or []
        title = (results[0] or {}).get("title", "(no result)") if results else "(no result)"
        status("OpenAlex", True, f"200 OK — got '{title[:60]}'")
    else:
        status("OpenAlex", False, f"{r.status_code}: {r.text[:120]}")


def test_crossref(email: str) -> None:
    if not email:
        status("CrossRef", False, "no email set")
        return
    try:
        r = httpx.get(
            "https://api.crossref.org/works",
            params={"query": "graph neural networks", "rows": 1, "mailto": email},
            headers={"User-Agent": f"research-mvp-test/0.1 (mailto:{email})"},
            timeout=20.0,
        )
    except httpx.HTTPError as e:
        status("CrossRef", False, f"network: {e}")
        return
    if r.status_code == 200:
        items = (r.json().get("message") or {}).get("items") or []
        title = (items[0].get("title") or ["(no result)"])[0] if items else "(no result)"
        status("CrossRef", True, f"200 OK — got '{title[:60]}'")
    else:
        status("CrossRef", False, f"{r.status_code}: {r.text[:120]}")


def test_pubmed(key: str) -> None:
    if not key:
        status("PubMed", False, "no key set")
        return
    try:
        r = httpx.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={
                "db": "pubmed",
                "term": "graph neural networks",
                "retmax": 1,
                "retmode": "json",
                "api_key": key,
            },
            headers={"User-Agent": "research-mvp-test/0.1"},
            timeout=20.0,
        )
    except httpx.HTTPError as e:
        status("PubMed", False, f"network: {e}")
        return
    if r.status_code == 200:
        es = (r.json().get("esearchresult") or {})
        count = es.get("count", "?")
        ids = es.get("idlist") or []
        status("PubMed", True, f"200 OK — {count} hits, first id {ids[0] if ids else '(none)'}")
    else:
        status("PubMed", False, f"{r.status_code}: {r.text[:120]}")


def main() -> int:
    if not ENV_PATH.exists():
        print(f"No .env at {ENV_PATH}", file=sys.stderr)
        return 1
    env = load_env()
    print(f"Loaded {len(env)} keys from {ENV_PATH}\n")
    test_semantic_scholar(env.get("SEMANTIC_SCHOLAR_API_KEY", ""))
    test_openalex(env.get("OPENALEX_EMAIL", ""))
    test_crossref(env.get("CROSSREF_EMAIL", ""))
    test_pubmed(env.get("PUBMED_API_KEY", ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
