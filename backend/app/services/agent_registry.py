"""Register Harness agents with the Gemini Managed Agents API."""

from __future__ import annotations

from typing import Any, Callable

from app.config import Settings
from app.services.agent_config import AgentConfigBuilder


def _is_not_found(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "not found" in msg or "not_found" in msg or "404" in msg


def _is_already_exists(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "already exists" in msg or "409" in msg or "conflict" in msg


def ensure_managed_agent(
    client: Any,
    settings: Settings,
    agent_row: dict[str, Any],
    environment_row: dict[str, Any] | None,
    mcp_servers: list[dict[str, Any]],
    *,
    on_log: Callable[[str], None] | None = None,
) -> str:
    """
    Ensure agent_row["agent_id"] exists on the Gemini platform (agents.create if missing).
    """
    agent_id = agent_row["agent_id"]

    try:
        client.agents.get(id=agent_id)
        return agent_id
    except Exception as exc:
        if not _is_not_found(exc):
            raise

    config = AgentConfigBuilder(settings).build(agent_row, environment_row, mcp_servers)
    if on_log:
        on_log(f"Registering managed agent '{agent_id}' on Gemini…")

    try:
        client.agents.create(**config)
        if on_log:
            on_log(f"Registered managed agent '{agent_id}'.")
    except Exception as exc:
        if _is_already_exists(exc):
            if on_log:
                on_log(f"Managed agent '{agent_id}' already exists.")
            return agent_id
        raise

    return agent_id
