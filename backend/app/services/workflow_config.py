"""Resolve per-role OpenHands agent configs for implementation workflows."""

from __future__ import annotations

from typing import Any

from app.config import get_settings
from app.services.firestore import get_firestore
from app.services.openhands_agent_settings import build_openhands_settings
from app.services.skill_sync import resolve_agent_skills_for_execution

WORKFLOW_ROLES = ("develop", "review", "test", "deploy")

DEFAULT_WORKFLOW_STEPS = ("develop", "review", "test", "deploy")

# Phases must appear in this order; any subsequence starting with develop and ending with deploy is valid.
_ORDERED_FULL_PIPELINE = DEFAULT_WORKFLOW_STEPS


def normalize_workflow_steps(raw: object) -> list[str]:
    """Return a valid ordered subsequence of develop → review → test → deploy."""
    if not isinstance(raw, list) or not raw:
        return list(DEFAULT_WORKFLOW_STEPS)
    allowed = set(_ORDERED_FULL_PIPELINE)
    seen: set[str] = set()
    steps: list[str] = []
    for item in raw:
        s = str(item).strip().lower()
        if s not in allowed or s in seen:
            continue
        seen.add(s)
        steps.append(s)
    if not steps:
        return list(DEFAULT_WORKFLOW_STEPS)
    # Must be an ordered subsequence of the full pipeline (e.g. develop, test, deploy).
    j = 0
    for phase in _ORDERED_FULL_PIPELINE:
        if j < len(steps) and steps[j] == phase:
            j += 1
    if j != len(steps):
        return list(DEFAULT_WORKFLOW_STEPS)
    if steps[0] != "develop" or steps[-1] != "deploy":
        return list(DEFAULT_WORKFLOW_STEPS)
    return steps


def effective_workflow_steps(goal_row: dict[str, Any] | None) -> list[str]:
    if not goal_row:
        return list(DEFAULT_WORKFLOW_STEPS)
    raw = goal_row.get("workflow_steps")
    return normalize_workflow_steps(raw)


def merge_workflow_roles(
    application_row: dict[str, Any],
    goal_row: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Goal-level roles override application defaults."""
    app_roles = application_row.get("workflow_roles") or {}
    if not isinstance(app_roles, dict):
        app_roles = {}
    goal_roles = {}
    if goal_row:
        raw = goal_row.get("workflow_roles") or {}
        if isinstance(raw, dict):
            goal_roles = {k: str(v).strip() for k, v in raw.items() if str(v).strip()}
    merged: dict[str, str] = {}
    for role in WORKFLOW_ROLES:
        value = (goal_roles.get(role) or app_roles.get(role) or "").strip()
        if value:
            merged[role] = value
    return merged


def workflow_enabled(application_row: dict[str, Any], goal_row: dict[str, Any] | None = None) -> bool:
    """True when develop + deploy agents are assigned (goal overrides app)."""
    merged = merge_workflow_roles(application_row, goal_row)
    if not (merged.get("develop") and merged.get("deploy")):
        return False
    steps = effective_workflow_steps(goal_row)
    return "develop" in steps and "deploy" in steps


def workflow_enabled_application(application_row: dict[str, Any]) -> bool:
    return workflow_enabled(application_row, None)


def resolve_workflow_roles(
    application_row: dict[str, Any],
    user_id: str,
    goal_row: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """
    Build payload for coding agents: role -> {agent_record_id, display_name, skills, mcp_servers, ...}
    """
    merged = merge_workflow_roles(application_row, goal_row)
    if not workflow_enabled(application_row, goal_row):
        return None
    raw_roles = merged
    steps_set = set(effective_workflow_steps(goal_row))

    db = get_firestore()
    settings = get_settings()
    resolved: dict[str, Any] = {}

    for role in WORKFLOW_ROLES:
        if role not in steps_set:
            continue
        record_id = raw_roles.get(role, "")
        if not record_id:
            if role in ("develop", "deploy"):
                return None
            record_id = raw_roles.get("develop", "")
            if not record_id:
                return None

        agent_row = db.get_agent(record_id, user_id)
        if not agent_row:
            raise ValueError(f"Unknown agent for workflow role '{role}'")

        mcp_servers = []
        for mcp_id in agent_row.get("mcp_server_ids") or []:
            mcp = db.get_mcp_server(mcp_id, user_id)
            if mcp:
                mcp_servers.append(mcp)

        skills = resolve_agent_skills_for_execution(agent_row, user_id)

        openhands_settings = build_openhands_settings(
            agent_row,
            mcp_servers,
            settings,
            user_id,
            include_secrets=True,
        )
        resolved[role] = {
            "agent_record_id": record_id,
            "display_name": agent_row.get("display_name") or agent_row.get("agent_id") or role,
            "system_instruction": agent_row.get("system_prompt")
            or agent_row.get("system_instruction")
            or "",
            "skills": skills,
            "openhands_settings": openhands_settings,
            "mcp_servers": [
                {
                    "name": m["name"],
                    "url": m["url"],
                    "header_key": m.get("header_key") or "",
                    "header_value": m.get("header_value") or "",
                }
                for m in mcp_servers
            ],
        }

    return resolved
