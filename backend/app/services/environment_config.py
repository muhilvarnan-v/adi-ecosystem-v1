from typing import Any

from app.config import Settings
from app.schemas.environment import NetworkMode
from app.services.github_sandbox import normalize_sandbox_network


class EnvironmentConfigBuilder:
    def __init__(self, settings: Settings) -> None:
        self._project = settings.agent_platform_project_id or settings.firestore_project_id
        self._location = settings.agent_platform_location

    def build(self, row: dict[str, Any]) -> dict[str, Any]:
        sources: list[dict[str, Any]] = []

        for attachment in row.get("skill_attachments") or []:
            skill_id = attachment["skill_id"]
            sources.append(
                {
                    "type": "skill_registry",
                    "source": f"projects/{self._project}/locations/{self._location}/skills/{skill_id}",
                    "target": attachment.get("target") or "/.agent/skills/",
                }
            )

        for src in row.get("additional_sources") or []:
            sources.append(dict(src))

        config: dict[str, Any] = {"type": "remote"}

        raw_kind = row.get("sandbox_type") or "docker"
        if raw_kind == "remote":
            key_set = bool((row.get("remote_runtime_api_key") or "").strip())
            config["openhands_sandbox"] = {
                "kind": "remote",
                "runtime_api_url": (row.get("remote_runtime_api_url") or "").strip(),
                "server_image": (row.get("remote_server_image") or "").strip(),
                "runtime_api_key": "••••••••" if key_set else "",
            }
        else:
            config["openhands_sandbox"] = {
                "kind": "docker",
                "server_image": (row.get("docker_server_image") or "").strip()
                or "ghcr.io/openhands/agent-server:latest-python",
                "host_port": int(row.get("docker_host_port") or 3000),
            }

        if sources:
            config["sources"] = sources

        network_mode = row.get("network_mode", NetworkMode.DEFAULT.value)
        if network_mode == NetworkMode.DISABLED.value:
            config["network"] = "disabled"
        elif network_mode == NetworkMode.ALLOWLIST.value:
            # Stored allowlist rules are kept in Firestore for UI; API only accepts "*".
            config["network"] = normalize_sandbox_network({"allowlist": []})

        return config
