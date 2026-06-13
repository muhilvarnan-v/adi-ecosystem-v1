"""Build OpenHands Agent settings payloads from Harness agent records."""

from __future__ import annotations

from typing import Any

from app.config import Settings
from app.services.firestore import get_firestore

# Matches openhands.tools.* ToolDefinition.name values
DEFAULT_OPENHANDS_TOOLS = ["terminal", "file_editor", "task_tracker"]

OPENHANDS_TOOL_OPTIONS: list[dict[str, str]] = [
    {
        "id": "terminal",
        "label": "Terminal",
        "description": "Run shell commands in the agent workspace (reasoning-action loop).",
    },
    {
        "id": "file_editor",
        "label": "File editor",
        "description": "Read and edit repository files.",
    },
    {
        "id": "task_tracker",
        "label": "Task tracker",
        "description": "Structured task list for multi-step implementation work.",
    },
]

CRITIC_MODE_OPTIONS = [
    {"id": "finish_and_message", "label": "Finish and message"},
    {"id": "all_actions", "label": "All actions"},
]

SECURITY_ANALYZER_OPTIONS = [
    {"id": "llm", "label": "LLM security analyzer"},
    {"id": "none", "label": "None"},
]


def normalize_agent_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map legacy Gemini-era fields to OpenHands agent shape."""
    out = dict(row)
    out.setdefault("agent_kind", "openhands")
    if not out.get("system_prompt") and out.get("system_instruction"):
        out["system_prompt"] = out["system_instruction"]
    out.setdefault("system_prompt", "")
    tools = out.get("tools")
    if not tools:
        out["tools"] = list(DEFAULT_OPENHANDS_TOOLS)
    out.setdefault("llm_profile_id", None)
    out.setdefault("llm_model", None)
    out.setdefault("load_project_skills", True)
    out.setdefault("condenser_enabled", True)
    out.setdefault("condenser_max_size", 240)
    out.setdefault("critic_enabled", False)
    out.setdefault("critic_mode", "finish_and_message")
    out.setdefault("enable_iterative_refinement", False)
    out.setdefault("critic_threshold", 0.6)
    out.setdefault("max_refinement_iterations", 3)
    out.setdefault("confirmation_mode", False)
    out.setdefault("security_analyzer", "llm")
    out.setdefault("mcp_server_ids", out.get("mcp_server_ids") or [])
    out.setdefault("environment_id", out.get("environment_id"))
    out.setdefault("skill_attachments", out.get("skill_attachments") or [])
    return out


def build_mcp_config(mcp_servers: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not mcp_servers:
        return None

    def _normalized_map(raw: Any) -> dict[str, str]:
        if not isinstance(raw, dict):
            return {}
        out: dict[str, str] = {}
        for k, v in raw.items():
            key = str(k).strip()
            value = str(v).strip()
            if key and value:
                out[key] = value
        return out

    def _normalized_args(raw: Any) -> list[str]:
        if not isinstance(raw, list):
            return []
        return [str(v).strip() for v in raw if str(v).strip()]

    def _entry_for_server(mcp: dict[str, Any]) -> dict[str, Any] | None:
        transport = str(mcp.get("transport") or "").strip().lower()
        if transport not in {"http", "sse", "stdio", "manual"}:
            transport = "manual" if isinstance(mcp.get("manual_config"), dict) else "http"

        if transport == "manual":
            manual = mcp.get("manual_config")
            return dict(manual) if isinstance(manual, dict) and manual else None

        if transport in {"http", "sse"}:
            url = str(mcp.get("url") or "").strip()
            if not url:
                return None
            entry: dict[str, Any] = {"transport": transport, "url": url}

            headers = _normalized_map(mcp.get("headers"))
            if not headers:
                hk = str(mcp.get("header_key") or "").strip()
                hv = str(mcp.get("header_value") or "").strip()
                if hk and hv:
                    headers = {hk: hv}
            if headers:
                entry["headers"] = headers

            auth = str(mcp.get("auth") or "").strip()
            if auth:
                entry["auth"] = auth
            return entry

        command = str(mcp.get("command") or "").strip()
        if not command:
            return None
        entry = {"transport": "stdio", "command": command}
        args = _normalized_args(mcp.get("args"))
        if args:
            entry["args"] = args
        env = _normalized_map(mcp.get("env"))
        if env:
            entry["env"] = env
        return entry

    servers: dict[str, Any] = {}
    used: set[str] = set()
    for mcp in mcp_servers:
        raw = str(mcp.get("name") or "mcp").strip()
        slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw.lower()).strip("-_") or "mcp"
        name = slug
        n = 2
        while name in used:
            name = f"{slug}-{n}"
            n += 1
        used.add(name)
        entry = _entry_for_server(mcp)
        if entry:
            servers[name] = entry
    if not servers:
        return None
    return {"mcpServers": servers}


def resolve_llm_config(
    agent_row: dict[str, Any],
    settings: Settings,
    user_id: str,
    *,
    include_secrets: bool = False,
) -> dict[str, Any]:
    """Resolve LiteLLM model, base_url, and api_key for an agent."""
    row = normalize_agent_row(agent_row)
    profile_id = (row.get("llm_profile_id") or "").strip()
    if profile_id:
        db = get_firestore()
        profile = db.get_llm_profile(profile_id, user_id)
        if not profile:
            raise ValueError("Linked LLM profile not found")
        llm = {
            "model": (profile.get("model") or "").strip(),
            "base_url": (profile.get("base_url") or "").strip() or None,
            "llm_profile_id": profile_id,
            "vendor_type": profile.get("vendor_type") or "litellm",
        }
        if include_secrets:
            llm["api_key"] = (profile.get("api_key") or "").strip()
        return llm

    return {
        "model": (row.get("llm_model") or "").strip() or (settings.llm_model or "").strip(),
        "base_url": (settings.llm_base_url or "").strip() or None,
        "llm_profile_id": None,
        "vendor_type": "litellm",
        **({"api_key": (settings.llm_api_key or "").strip()} if include_secrets else {}),
    }


def mask_openhands_settings_for_preview(config: dict[str, Any]) -> dict[str, Any]:
    """Remove API keys from settings shown in the UI."""
    import copy

    out = copy.deepcopy(config)
    llm = out.get("llm")
    if isinstance(llm, dict) and llm.get("api_key"):
        llm = dict(llm)
        llm["api_key"] = "••••••••"
        out["llm"] = llm
    return out


def build_openhands_settings(
    agent_row: dict[str, Any],
    mcp_servers: list[dict[str, Any]],
    settings: Settings,
    user_id: str,
    *,
    include_secrets: bool = False,
) -> dict[str, Any]:
    """
    Serializable OpenHandsAgentSettings-shaped dict for preview and coding-agent runs.

    See: https://docs.openhands.dev/sdk/guides/agent-settings
    """
    row = normalize_agent_row(agent_row)
    llm_resolved = resolve_llm_config(agent_row, settings, user_id, include_secrets=include_secrets)
    model = llm_resolved["model"]
    tools = [t for t in (row.get("tools") or DEFAULT_OPENHANDS_TOOLS) if t in {o["id"] for o in OPENHANDS_TOOL_OPTIONS}]
    if not tools:
        tools = list(DEFAULT_OPENHANDS_TOOLS)

    payload: dict[str, Any] = {
        "agent_kind": "openhands",
        "agent": "CodeActAgent",
        "llm": {
            k: v
            for k, v in {
                "model": model,
                "base_url": llm_resolved.get("base_url"),
                "api_key": llm_resolved.get("api_key"),
                "llm_profile_id": llm_resolved.get("llm_profile_id"),
                "vendor_type": llm_resolved.get("vendor_type"),
            }.items()
            if v is not None and v != ""
        },
        "tools": [{"name": name} for name in tools],
        "agent_context": {
            "load_project_skills": bool(row.get("load_project_skills", True)),
        },
        "condenser": {
            "enabled": bool(row.get("condenser_enabled", True)),
            "max_size": int(row.get("condenser_max_size") or 240),
        },
        "verification": {
            "critic_enabled": bool(row.get("critic_enabled", False)),
            "critic_mode": row.get("critic_mode") or "finish_and_message",
            "enable_iterative_refinement": bool(row.get("enable_iterative_refinement", False)),
            "critic_threshold": float(row.get("critic_threshold") or 0.6),
            "max_refinement_iterations": int(row.get("max_refinement_iterations") or 3),
        },
        "conversation": {
            "confirmation_mode": bool(row.get("confirmation_mode", False)),
            "security_analyzer": row.get("security_analyzer") or "llm",
        },
    }

    system_prompt = (row.get("system_prompt") or "").strip()
    if system_prompt:
        payload["system_prompt"] = system_prompt

    mcp_config = build_mcp_config(mcp_servers)
    if mcp_config:
        payload["mcp_config"] = mcp_config

    return payload


def export_openhands_schema() -> dict[str, Any]:
    """UI schema describing OpenHands agent concepts (mirrors SDK settings sections)."""
    return {
        "docs_url": "https://docs.openhands.dev/sdk/arch/agent",
        "agent_kind": "openhands",
        "sections": [
            {
                "key": "identity",
                "label": "Identity",
                "description": "Harness record for this OpenHands agent profile.",
            },
            {
                "key": "llm",
                "label": "LLM",
                "description": "LiteLLM profile from Harness → LLM (model, base URL, API key).",
            },
            {
                "key": "prompt",
                "label": "System prompt",
                "description": "Overrides default CodeAct instructions when set (Agent.system_prompt).",
            },
            {
                "key": "context",
                "label": "Skills",
                "description": "Skills attached to this agent or sandbox; they are copied into the repo for each run so the agent can use them.",
            },
            {
                "key": "tools",
                "label": "Tools",
                "description": "Built-in tools in the action-observation loop.",
                "options": OPENHANDS_TOOL_OPTIONS,
            },
            {
                "key": "mcp",
                "label": "MCP",
                "description": "Model Context Protocol servers merged into mcp_config.",
            },
            {
                "key": "condenser",
                "label": "Condenser",
                "description": "Compress conversation history when context limits are approached.",
            },
            {
                "key": "verification",
                "label": "Verification & iterative refinement",
                "description": "Optional critic loop inside a single agent run.",
                "critic_modes": CRITIC_MODE_OPTIONS,
            },
            {
                "key": "security",
                "label": "Security",
                "description": "Confirmation policy and security analyzer before tool execution.",
                "security_analyzers": SECURITY_ANALYZER_OPTIONS,
            },
        ],
        "default_tools": DEFAULT_OPENHANDS_TOOLS,
    }
