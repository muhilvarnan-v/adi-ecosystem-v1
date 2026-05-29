"""Resolve GitHub credentials for API calls."""

from __future__ import annotations

from app.config import get_settings
from app.schemas.integration import IntegrationProvider
from app.services.firestore import get_firestore


def resolve_github_tokens(user_id: str) -> list[str]:
    """OAuth token first, then optional GITHUB_TOKEN from settings (deduped)."""
    tokens: list[str] = []
    db = get_firestore()
    integration = db.get_integration(user_id, IntegrationProvider.GITHUB.value)
    if integration:
        oauth = (integration.get("tokens") or {}).get("access_token")
        if isinstance(oauth, str):
            oauth = oauth.strip()
            if oauth:
                tokens.append(oauth)
    env_token = (get_settings().github_token or "").strip()
    if env_token and env_token not in tokens:
        tokens.append(env_token)
    return tokens


def resolve_github_token(user_id: str) -> str | None:
    resolved = resolve_github_tokens(user_id)
    return resolved[0] if resolved else None
