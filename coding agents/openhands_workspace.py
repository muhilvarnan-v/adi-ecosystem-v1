"""Pick OpenHands SDK workspace: local clone, Docker agent-server host, or runtime API sandbox."""

from __future__ import annotations

import os
import socket
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

if TYPE_CHECKING:
    from openhands.sdk.workspace.base import BaseWorkspace


def _host_is_reachable(host_url: str) -> bool:
    parsed = urlparse(host_url)
    hostname = parsed.hostname
    if not hostname:
        return False
    if parsed.port:
        port = parsed.port
    elif parsed.scheme == "https":
        port = 443
    else:
        port = 80
    try:
        with socket.create_connection((hostname, port), timeout=1.5):
            return True
    except OSError:
        return False


def _local_workspace(repo_dir: Path):
    from openhands.sdk.workspace import LocalWorkspace

    return LocalWorkspace(working_dir=repo_dir)


def _fallback_to_local(repo_dir: Path, host: str, source: str):
    print(
        (
            f"[warn] OpenHands runtime host is unreachable ({host}) from {source}. "
            "Falling back to LocalWorkspace."
        ),
        file=sys.stderr,
        flush=True,
    )
    return _local_workspace(repo_dir)


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
            if not _host_is_reachable(host):
                return _fallback_to_local(repo_dir, host, "workflow sandbox")
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

        if not _host_is_reachable(host):
            return _fallback_to_local(repo_dir, host, "OPENHANDS_RUNTIME_HOST")
        api_key = (os.environ.get("OPENHANDS_RUNTIME_API_KEY") or "").strip() or None
        return Workspace(working_dir=str(repo_dir), host=host, api_key=api_key)

    return _local_workspace(repo_dir)
