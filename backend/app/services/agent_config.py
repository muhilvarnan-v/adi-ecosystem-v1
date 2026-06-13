from typing import Any

from app.config import Settings
from app.schemas.agent import normalize_builtin_tools
from app.services.environment_config import EnvironmentConfigBuilder
from app.services.github_sandbox import normalize_sandbox_network


class AgentConfigBuilder:
    """Build Managed Agents API payloads (create/manage agents)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._env_builder = EnvironmentConfigBuilder(settings)

    def build(
        self,
        agent_row: dict[str, Any],
        environment_row: dict[str, Any] | None,
        mcp_servers: list[dict[str, Any]],
    ) -> dict[str, Any]:
        config: dict[str, Any] = {
            "id": agent_row["agent_id"],
            "base_agent": agent_row["base_agent"],
        }

        description = agent_row.get("description", "").strip()
        if description:
            config["description"] = description

        system_instruction = agent_row.get("system_instruction", "").strip()
        if system_instruction:
            config["system_instruction"] = system_instruction

        tools: list[dict[str, Any]] = [
            {"type": tool_type}
            for tool_type in normalize_builtin_tools(agent_row.get("builtin_tools"))
        ]

        for mcp in mcp_servers:
            transport = str(mcp.get("transport") or "").strip().lower() or "http"
            url = (mcp.get("url") or "").strip()
            if transport not in {"http", "sse"} or not url:
                continue
            tool: dict[str, Any] = {
                "type": "mcp_server",
                "name": mcp["name"],
                "url": url,
            }
            headers = mcp.get("headers") or {}
            if isinstance(headers, dict):
                filtered = {
                    str(k).strip(): str(v).strip()
                    for k, v in headers.items()
                    if str(k).strip() and str(v).strip()
                }
            else:
                filtered = {}
            if not filtered:
                header_key = (mcp.get("header_key") or "").strip()
                header_value = (mcp.get("header_value") or "").strip()
                if header_key and header_value:
                    filtered = {header_key: header_value}
            if filtered:
                tool["headers"] = filtered
            tools.append(tool)

        if tools:
            config["tools"] = tools

        if environment_row:
            base_environment = self._env_builder.build(environment_row)
            if isinstance(base_environment, dict) and "network" in base_environment:
                normalized = normalize_sandbox_network(base_environment["network"])
                if normalized is not None:
                    base_environment = {**base_environment, "network": normalized}
                else:
                    base_environment = {
                        k: v for k, v in base_environment.items() if k != "network"
                    }
            config["base_environment"] = base_environment

        return config
