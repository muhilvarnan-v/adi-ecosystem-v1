"""Build OpenHands Agent + Conversation from OpenHandsAgentSettings-shaped payloads."""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from openhands_workspace import resolve_openhands_workspace
from run_multi_repo import build_llm, format_openhands_event, import_openhands_sdk, resolve_llm_model
from skills_setup import materialize_skills


def build_mcp_config(mcp_servers: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Map Harness MCP server rows to OpenHands / fastmcp MCPConfig shape."""
    if not mcp_servers:
        return {}
    servers: dict[str, Any] = {}
    used_names: set[str] = set()
    for mcp in mcp_servers:
        raw_name = str(mcp.get("name") or "mcp").strip()
        slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw_name.lower())
        slug = slug.strip("-_") or "mcp"
        name = slug
        n = 2
        while name in used_names:
            name = f"{slug}-{n}"
            n += 1
        used_names.add(name)
        entry: dict[str, Any] = {
            "url": str(mcp["url"]).strip(),
            "transport": "http",
        }
        header_key = (mcp.get("header_key") or "").strip()
        header_value = (mcp.get("header_value") or "").strip()
        if header_key and header_value:
            entry["headers"] = {header_key: header_value}
        servers[name] = entry
    return {"mcpServers": servers}


def _resolve_tools(tool_specs: list[Any]) -> list[str]:
    names: list[str] = []
    for item in tool_specs or []:
        if isinstance(item, dict):
            name = item.get("name")
        else:
            name = str(item)
        if name:
            names.append(str(name))
    if not names:
        return ["terminal", "file_editor", "task_tracker"]
    return names


def create_agent_and_conversation(
    *,
    repo_dir: Path,
    api_key: str,
    skills: list[dict[str, Any]] | None,
    openhands_settings: dict[str, Any] | None = None,
    mcp_servers: list[dict[str, Any]] | None = None,
    system_instruction: str | None = None,
    on_log: Callable[[str], None] | None = None,
    openhands_sandbox: dict[str, Any] | None = None,
) -> tuple[Any, Any, Any]:
    settings = openhands_settings or {}
    llm_cfg = settings.get("llm") or {}
    model = str(llm_cfg.get("model") or resolve_llm_model(None)).strip()
    base_url = llm_cfg.get("base_url")
    if base_url:
        os.environ["LLM_BASE_URL"] = str(base_url).strip()
    profile_api_key = (llm_cfg.get("api_key") or "").strip()
    effective_api_key = profile_api_key or api_key

    (
        Agent,
        Conversation,
        _,
        Tool,
        FileEditorTool,
        TaskTrackerTool,
        TerminalTool,
        AgentContext,
    ) = import_openhands_sdk()

    tool_name_map = {
        "terminal": TerminalTool.name,
        "file_editor": FileEditorTool.name,
        "task_tracker": TaskTrackerTool.name,
    }
    selected = _resolve_tools(settings.get("tools") or [])
    tools = [Tool(name=tool_name_map.get(t, t)) for t in selected if t in tool_name_map]

    installed_skills: list[str] = []
    ctx_cfg = settings.get("agent_context") or {}
    load_skills = bool(ctx_cfg.get("load_project_skills", True))
    if skills and load_skills:
        installed_skills = materialize_skills(repo_dir, skills)
        if installed_skills and on_log:
            on_log(f"Installed skills: {', '.join(installed_skills)}")

    llm = build_llm(model=model, api_key=effective_api_key)
    agent_context = AgentContext(load_project_skills=True) if installed_skills else None

    mcp_config = settings.get("mcp_config") or build_mcp_config(mcp_servers)
    if isinstance(mcp_config, dict) and not mcp_config:
        mcp_config = None

    system_prompt = (settings.get("system_prompt") or system_instruction or "").strip()

    agent_kwargs: dict[str, Any] = {
        "llm": llm,
        "agent_context": agent_context,
        "tools": tools,
    }
    if mcp_config:
        agent_kwargs["mcp_config"] = mcp_config
    if system_prompt:
        agent_kwargs["system_prompt"] = system_prompt

    agent = Agent(**agent_kwargs)

    def event_callback(event: Any) -> None:
        line = format_openhands_event(event)
        if line and on_log:
            on_log(line)

    workspace = resolve_openhands_workspace(repo_dir, openhands_sandbox)
    conversation = Conversation(
        agent=agent,
        workspace=workspace,
        callbacks=[event_callback],
        visualizer=None,
    )
    return agent, conversation, workspace
