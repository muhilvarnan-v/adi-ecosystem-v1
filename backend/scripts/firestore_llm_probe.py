#!/usr/bin/env python3
"""
List Firestore ``llm_profiles`` documents and probe GET /v1/models + POST /v1/chat/completions
using each row's model / base_url / api_key (same shape as Harness → coding agents).

Usage (from repo root, with ADC or GOOGLE_APPLICATION_CREDENTIALS):

  cd backend && python scripts/firestore_llm_probe.py

Env: loads ``backend/.env``. Project: ``FIRESTORE_PROJECT_ID`` or ``GOOGLE_CLOUD_PROJECT``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from google.cloud import firestore

BACKEND_ROOT = Path(__file__).resolve().parents[1]
LLM_PROFILES = "llm_profiles"


def normalize_openai_compatible_api_base(url: str) -> str:
    """Match coding agents/run_multi_repo.py (host-only → …/v1)."""
    t = (url or "").strip().rstrip("/")
    if not t:
        return t
    parsed = urlparse(t)
    path = (parsed.path or "").rstrip("/")
    if path == "":
        return f"{t}/v1"
    if path.endswith("/v1"):
        return t
    return t


def mask(s: str, keep: int = 4) -> str:
    s = (s or "").strip()
    if len(s) <= keep:
        return "•••" if s else ""
    return f"•••{s[-keep:]}"


def probe_one(*, base_url: str, api_key: str, model: str, label: str) -> tuple[int, str]:
    base = normalize_openai_compatible_api_base(base_url)
    if not api_key:
        print(f"  [{label}] skip: empty api_key")
        return 1, "no key"
    headers_json = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        rm = httpx.get(
            base.rstrip("/") + "/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0,
        )
        print(f"  [{label}] GET /models -> {rm.status_code}")
        rc = httpx.post(
            base.rstrip("/") + "/chat/completions",
            headers=headers_json,
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
                "max_tokens": 8,
            },
            timeout=60.0,
        )
        ct = rc.headers.get("content-type") or ""
        prev = rc.text[:180].replace("\n", " ")
        print(f"  [{label}] POST /chat/completions model={model!r} -> {rc.status_code} ({ct[:40]})")
        print(f"  [{label}] body preview: {prev!r}")
        return (0 if rc.status_code == 200 and "json" in ct else 1), prev
    except httpx.RequestError as exc:
        print(f"  [{label}] request error: {exc}")
        return 1, str(exc)


def main() -> int:
    load_dotenv(BACKEND_ROOT / ".env")
    project = (os.environ.get("FIRESTORE_PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT") or "").strip()
    if not project:
        print("Set FIRESTORE_PROJECT_ID or GOOGLE_CLOUD_PROJECT in backend/.env", file=sys.stderr)
        return 1

    client = firestore.Client(project=project)
    docs = list(client.collection(LLM_PROFILES).stream())
    if not docs:
        print(f"No documents in {LLM_PROFILES!r} (project={project}).")
        return 1

    print(f"Firestore project={project!r}, collection={LLM_PROFILES!r}, count={len(docs)}\n")
    worst = 0
    for doc in docs:
        row = doc.to_dict() or {}
        row["id"] = doc.id
        uid = str(row.get("user_id") or "")
        model = str(row.get("model") or "").strip()
        base_url = str(row.get("base_url") or "").strip()
        name = str(row.get("display_name") or "").strip()
        key = str(row.get("api_key") or "").strip()
        print(
            f"--- profile id={doc.id!r} display_name={name!r} user_id={uid[:12]}… ---\n"
            f"  model={model!r}\n"
            f"  base_url(raw)={base_url!r}\n"
            f"  base_url(norm)={normalize_openai_compatible_api_base(base_url)!r}\n"
            f"  api_key={mask(key)}\n"
        )
        if not model:
            print("  skip: empty model\n")
            worst = 1
            continue
        code, _ = probe_one(
            base_url=base_url or os.environ.get("LLM_BASE_URL", ""),
            api_key=key or os.environ.get("LLM_API_KEY", ""),
            model=model,
            label=doc.id[:8],
        )
        worst = max(worst, code)
        print()
    return worst


if __name__ == "__main__":
    sys.exit(main())
