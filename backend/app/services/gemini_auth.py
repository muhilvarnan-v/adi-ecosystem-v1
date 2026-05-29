"""Gemini Managed Agents client factory (API key only)."""

from __future__ import annotations

import os

from app.config import Settings

API_REVISION = "2026-05-20"


def _resolve_api_key(settings: Settings) -> str:
    api_key = (
        settings.gemini_api_key
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or ""
    ).strip()
    if not api_key:
        raise RuntimeError("Missing Gemini API key. Set GEMINI_API_KEY or GOOGLE_API_KEY.")
    return api_key


def create_genai_client(settings: Settings):
    from google import genai

    return genai.Client(api_key=_resolve_api_key(settings))


def rest_auth_headers(settings: Settings) -> dict[str, str]:
    """Headers for raw REST calls (e.g. environment snapshot download)."""
    return {
        "Api-Revision": API_REVISION,
        "x-goog-api-key": _resolve_api_key(settings),
    }
