"""Pick OpenHands SDK workspace: local clone, Docker agent-server host, or runtime API sandbox."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from openhands.sdk.workspace.base import BaseWorkspace


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
            from openhands.sdk.workspace import Workspace

            host = str(spec.get("runtime_host") or "").strip().rstrip("/")
            if not host:
                port = int(spec.get("host_port") or 8010)
                host = f"http://127.0.0.1:{port}"
            api_key = (spec.get("runtime_api_key") or "").strip() or None
            return Workspace(working_dir=str(repo_dir), host=host, api_key=api_key)

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
