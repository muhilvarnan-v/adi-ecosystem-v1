#!/usr/bin/env python3
"""Diagnose LiteLLM / OpenAI-compatible gateways (403 HTML vs JSON errors).

Loads ``coding agents/.env`` then ``../backend/.env`` (if present) for LLM_* vars.

Exit codes: 0 if chat/completions returns 2xx, 1 otherwise.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent


def main() -> int:
    load_dotenv(ROOT / ".env")
    backend_env = ROOT.parent / "backend" / ".env"
    if backend_env.is_file():
        load_dotenv(backend_env, override=True)

    from run_multi_repo import normalize_openai_compatible_api_base, resolve_llm_model

    import os

    raw = (os.environ.get("LLM_BASE_URL") or "").strip()
    key = (os.environ.get("LLM_API_KEY") or "").strip()
    model = resolve_llm_model(None)

    if not key:
        print("Missing LLM_API_KEY (set in coding agents/.env or backend/.env).", file=sys.stderr)
        return 1

    base = normalize_openai_compatible_api_base(raw)
    print(f"Resolved API base: {base}")
    print(f"Model from env/default: {model}")
    print()

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    models_url = base.rstrip("/") + "/models"
    try:
        rm = httpx.get(models_url, headers={"Authorization": f"Bearer {key}"}, timeout=30.0)
        print(f"GET  {models_url}")
        print(f"     status={rm.status_code} content-type={rm.headers.get('content-type', '')[:50]}")
        if rm.status_code == 200:
            try:
                data = rm.json()
                ids = [m.get("id") for m in (data.get("data") or [])][:8]
                print(f"     model ids (sample): {ids}")
            except json.JSONDecodeError:
                print(f"     body (preview): {rm.text[:200]!r}")
        else:
            print(f"     body (preview): {rm.text[:200]!r}")
    except httpx.RequestError as exc:
        print(f"GET /models failed: {exc}", file=sys.stderr)
        return 1

    chat_url = base.rstrip("/") + "/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "max_tokens": 8,
    }
    try:
        rc = httpx.post(chat_url, headers=headers, json=body, timeout=60.0)
        print()
        print(f"POST {chat_url}")
        print(f"     status={rc.status_code} content-type={rc.headers.get('content-type', '')[:50]}")
        print(f"     via={rc.headers.get('via', '')!r}")
        prev = rc.text[:240].replace("\n", " ")
        print(f"     body (preview): {prev!r}")
    except httpx.RequestError as exc:
        print(f"POST /chat/completions failed: {exc}", file=sys.stderr)
        return 1

    print()
    if rc.status_code == 200 and "application/json" in (rc.headers.get("content-type") or ""):
        print("Chat completions: OK.")
        return 0

    if rc.status_code == 403 and "text/html" in (rc.headers.get("content-type") or ""):
        if rm.status_code == 200:
            print(
                "Diagnosis: API key works for GET /v1/models but POST /v1/chat/completions returns "
                "403 HTML. This is usually gateway / edge policy (e.g. Cloud Armor, IP allowlists, "
                "VPN-only access), not a wrong base URL path. Ask your GAP/LiteLLM admins to allow "
                "chat completions for your key or network path."
            )
        else:
            print(
                "Diagnosis: 403 HTML on chat. If /models also failed, check API key and base URL; "
                "otherwise see gateway policy / VPN requirements."
            )
    elif "text/html" in (rc.headers.get("content-type") or ""):
        print(
            "Diagnosis: HTML response usually means the wrong HTTP path (e.g. missing /v1 on the "
            "base URL) or a reverse proxy block. This repo normalizes host-only bases to …/v1 in "
            "run_multi_repo.normalize_openai_compatible_api_base."
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
