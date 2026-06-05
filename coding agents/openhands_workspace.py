"""Pick OpenHands SDK workspace: local clone, Docker agent-server host, or runtime API sandbox."""

from __future__ import annotations

import os
import platform
import inspect
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from openhands.sdk.workspace.base import BaseWorkspace


def resolve_docker_platform() -> str:
    """Pick native Linux arch unless explicitly overridden."""
    override = (os.environ.get("OPENHANDS_DOCKER_PLATFORM") or "").strip()
    if override:
        return override

    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        return "linux/arm64"
    return "linux/amd64"


def resolve_openhands_workspace(
    repo_dir: Path,
    openhands_sandbox: dict[str, Any] | None = None,
) -> "BaseWorkspace":
    """
    OpenHands *workspace* where tools run.

    Priority:
    1. ``openhands_sandbox`` from Harness workflow (Docker host port or hosted runtime API).
    2. ``OPENHANDS_RUNTIME_HOST`` / ``OPENHANDS_RUNTIME_API_KEY`` (legacy global env).
    3. ``LocalWorkspace`` on the repo clone directory.
    """
    spec = openhands_sandbox if isinstance(openhands_sandbox, dict) and openhands_sandbox else None
    if spec:
        kind = str(spec.get("kind") or "").strip().lower()
        if kind == "docker":
            try:
                from openhands.workspace import DockerWorkspace
            except ModuleNotFoundError as exc:
                raise RuntimeError(
                    'Docker sandbox requires the "openhands-workspace" package. '
                    'Install: pip install "openhands-workspace==1.24.0"'
                ) from exc

            image = str(spec.get("server_image") or "").strip() or "ghcr.io/openhands/agent-server:latest-python"
            docker_platform = resolve_docker_platform()
            workspace_kwargs = {
                "server_image": image,
                "workspace_dir": str(repo_dir),
                "platform": docker_platform,
            }
            try:
                params = inspect.signature(DockerWorkspace).parameters
            except (TypeError, ValueError):
                params = {}
            if "volumes" in params:
                workspace_kwargs["volumes"] = [f"{repo_dir}:/workspace:rw"]  # explicit rw to avoid root-owned files in some Docker versions

            return DockerWorkspace(**workspace_kwargs)

        if kind == "remote":
            try:
                from openhands.workspace import APIRemoteWorkspace
            except ModuleNotFoundError as exc:
                raise RuntimeError(
                    'Remote API sandbox requires the "openhands-workspace" package. '
                    'Install: pip install "openhands-workspace==1.24.0"'
                ) from exc
            url = str(spec.get("runtime_api_url") or "").strip().rstrip("/")
            key = str(spec.get("runtime_api_key") or "").strip()
            image = str(spec.get("server_image") or "").strip()
            if not url or not key or not image:
                raise RuntimeError("Remote sandbox payload is missing runtime_api_url, key, or server_image")
            return APIRemoteWorkspace(
                runtime_api_url=url,
                runtime_api_key=key,
                server_image=image,
                working_dir="/workspace",
            )

    host = (os.environ.get("OPENHANDS_RUNTIME_HOST") or "").strip().rstrip("/")
    if host:
        from openhands.sdk.workspace import Workspace

        api_key = (os.environ.get("OPENHANDS_RUNTIME_API_KEY") or "").strip() or None
        return Workspace(working_dir=str(repo_dir), host=host, api_key=api_key)

    from openhands.sdk.workspace import LocalWorkspace

    return LocalWorkspace(working_dir=repo_dir)


def activate_openhands_workspace(workspace: Any) -> tuple[Any, Any]:
    """Enter workspace context when available and return (active_workspace, close_handle)."""
    enter = getattr(workspace, "__enter__", None)
    if callable(enter):
        active = enter()
        return (active if active is not None else workspace), workspace
    return workspace, workspace


def close_openhands_workspace(workspace_handle: Any) -> None:
    """Best-effort context cleanup for workspaces created/entered above."""
    exit_fn = getattr(workspace_handle, "__exit__", None)
    if callable(exit_fn):
        exit_fn(None, None, None)
