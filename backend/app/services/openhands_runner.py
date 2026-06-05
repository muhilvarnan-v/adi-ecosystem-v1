"""Invoke the coding agents OpenHands runner in an isolated venv (avoids pip conflicts)."""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from app.config import Settings

LogCallback = Callable[[str, dict[str, Any] | None], None]
WorkflowCallback = Callable[[dict], None]
ChatCallback = Callable[[dict], None]

_AID_ROOT = Path(__file__).resolve().parents[3]
_CODING_AGENTS_DIR = _AID_ROOT / "coding agents"
_RUN_GOAL_SCRIPT = _CODING_AGENTS_DIR / "run_goal.py"
_DEFAULT_PYTHON = _CODING_AGENTS_DIR / ".venv" / "bin" / "python"
_ANSI_ESCAPE_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x1B\x07]*(?:\x07|\x1B\\\\))")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0B-\x1F\x7F]")


@dataclass
class OpenHandsRunResult:
    status: str
    pr_url: str | None
    summary: str | None
    error: str | None = None


def _clean_log_line(text: str) -> str:
    """Remove ANSI/control sequences so logs remain readable in non-TTY UIs."""
    cleaned = _ANSI_ESCAPE_RE.sub("", text)
    return _CONTROL_RE.sub("", cleaned)


def _resolve_python() -> Path:
    override = (os.environ.get("CODING_AGENTS_PYTHON") or "").strip()
    if override:
        return Path(override)
    if _DEFAULT_PYTHON.is_file():
        return _DEFAULT_PYTHON
    return Path(os.environ.get("PYTHON", "python3"))


def _probe_runtime_host(runtime_host: str) -> tuple[bool, str]:
    """Return runtime reachability and a short diagnostic string when unavailable."""
    host_value = runtime_host.strip()
    if not host_value:
        return True, ""

    parsed = urlparse(host_value if "://" in host_value else f"http://{host_value}")
    hostname = (parsed.hostname or "").strip()
    if not hostname:
        return False, f"invalid host '{runtime_host}'"

    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme == "https" else 80

    try:
        with socket.create_connection((hostname, port), timeout=1.5):
            return True, ""
    except OSError as exc:
        return False, f"{hostname}:{port} ({exc})"


def run_goal_on_repo(
    *,
    settings: Settings,
    repo_url: str,
    goal_text: str,
    base_branch: str,
    goal_id: str,
    github_token: str | None,
    skills: list[dict] | None = None,
    workflow_roles: dict[str, Any] | None = None,
    workflow_steps: list[str] | None = None,
    max_cycles: int = 3,
    on_log: LogCallback | None = None,
    on_workflow: WorkflowCallback | None = None,
    on_chat: ChatCallback | None = None,
    openhands_sandbox: dict[str, Any] | None = None,
    openhands_settings: dict[str, Any] | None = None,
) -> tuple[OpenHandsRunResult, dict | None]:
    python = _resolve_python()
    if not _RUN_GOAL_SCRIPT.is_file():
        raise RuntimeError(f"Missing coding agent script: {_RUN_GOAL_SCRIPT}")

    if not python.is_file() and str(python) not in ("python3", "python"):
        raise RuntimeError(
            f"Coding agents Python not found at {python}. "
            'Run: cd "coding agents" && python3 -m venv .venv && pip install -r requirements.txt'
        )

    payload: dict[str, Any] = {
        "repo_url": repo_url,
        "goal_text": goal_text,
        "base_branch": base_branch,
        "goal_id": goal_id,
        "github_token": github_token,
        "skills": skills or [],
        "workflow_roles": workflow_roles or {},
        "workflow_steps": workflow_steps or [],
        "max_cycles": max_cycles,
        "llm_api_key": (settings.llm_api_key or os.environ.get("LLM_API_KEY") or "").strip(),
        "llm_base_url": (settings.llm_base_url or "").strip(),
        "llm_model": (settings.llm_model or "").strip(),
    }
    if openhands_sandbox:
        payload["openhands_sandbox"] = openhands_sandbox
    if openhands_settings:
        payload["openhands_settings"] = openhands_settings

    env = os.environ.copy()
    env.setdefault("LITELLM_LOG", "ERROR")
    env.setdefault("NO_COLOR", "1")
    env.setdefault("PY_COLORS", "0")
    env.setdefault("CLICOLOR", "0")
    env.setdefault("FORCE_COLOR", "0")
    if openhands_sandbox:
        # Workflow-scoped sandbox overrides global runtime env for this subprocess.
        env.pop("OPENHANDS_RUNTIME_HOST", None)
        env.pop("OPENHANDS_RUNTIME_API_KEY", None)
    host = (settings.openhands_runtime_host or env.get("OPENHANDS_RUNTIME_HOST") or "").strip()
    rt_key = (settings.openhands_runtime_api_key or env.get("OPENHANDS_RUNTIME_API_KEY") or "").strip()
    remote_unavailable: str | None = None
    if host and not openhands_sandbox:
        reachable, diagnostic = _probe_runtime_host(host)
        if reachable:
            env["OPENHANDS_RUNTIME_HOST"] = host
            # Remote runtime servers expect paths in their own filesystem namespace.
            # Ensure the SDK does not send host-local paths (for example /var/folders/...)
            # as conversation workspace directories.
            env["OPENHANDS_RUNTIME_WORKING_DIR"] = "/workspace"
            if rt_key:
                env["OPENHANDS_RUNTIME_API_KEY"] = rt_key
        else:
            remote_unavailable = (
                f"OpenHands runtime unavailable at {host} ({diagnostic}). "
                "Falling back to LocalWorkspace for this run."
            )
            env.pop("OPENHANDS_RUNTIME_HOST", None)
            env.pop("OPENHANDS_RUNTIME_API_KEY", None)
            env.pop("OPENHANDS_RUNTIME_WORKING_DIR", None)
            if settings.openhands_require_remote_workspace:
                raise RuntimeError(
                    remote_unavailable.replace(
                        "Falling back to LocalWorkspace for this run.",
                        "Set OPENHANDS_RUNTIME_HOST to a reachable server or disable OPENHANDS_REQUIRE_REMOTE_WORKSPACE.",
                    )
                )
            if on_log:
                on_log(
                    remote_unavailable,
                    {
                        "event_kind": "orchestrator",
                        "observation_kind": "runtime_probe",
                        "preview": remote_unavailable,
                        "body": remote_unavailable,
                    },
                )
    if settings.openhands_require_remote_workspace:
        env["OPENHANDS_REQUIRE_REMOTE_WORKSPACE"] = "true"
    else:
        env.pop("OPENHANDS_REQUIRE_REMOTE_WORKSPACE", None)
    base_image = (settings.openhands_docker_base_image or "").strip()
    if base_image:
        env["OPENHANDS_DOCKER_BASE_IMAGE"] = base_image

    proc = subprocess.Popen(
        [str(python), str(_RUN_GOAL_SCRIPT)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(_CODING_AGENTS_DIR),
        env=env,
    )
    assert proc.stdin is not None
    assert proc.stdout is not None
    assert proc.stderr is not None
    proc.stdin.write(json.dumps(payload))
    proc.stdin.close()

    stderr_lines: list[str] = []

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for raw_line in proc.stderr:
            line = _clean_log_line(raw_line.rstrip("\n"))
            if not line:
                continue
            stderr_lines.append(line)
            if on_log:
                on_log(
                    f"[runner stderr] {line}",
                    {
                        "event_kind": "orchestrator",
                        "observation_kind": "stderr",
                        "preview": line,
                        "body": line,
                    },
                )

    stderr_thread = threading.Thread(target=_drain_stderr, daemon=True, name="openhands-stderr")
    stderr_thread.start()

    result_payload: dict | None = None
    workflow_graph: dict | None = None
    for raw_line in proc.stdout:
        raw_json_line = raw_line.strip()
        line = _clean_log_line(raw_json_line)
        if not line:
            continue
        try:
            event = json.loads(raw_json_line)
        except json.JSONDecodeError:
            if on_log:
                on_log(line)
            continue

        # Some dependencies print valid JSON scalars (e.g. `true` from
        # `docker inspect -f {{.State.Running}}`) to stdout. Only NDJSON
        # objects belong to our event protocol.
        if not isinstance(event, dict):
            if on_log:
                on_log(line)
            continue

        if event.get("type") == "log" and event.get("line"):
            if on_log:
                meta_keys = (
                    "agent",
                    "phase",
                    "cycle",
                    "agent_record_id",
                    "event_kind",
                    "message_role",
                    "action_type",
                    "observation_kind",
                    "preview",
                    "body",
                )
                meta = {
                    k: _clean_log_line(str(event[k])) for k in meta_keys if k in event and event[k] is not None
                }
                on_log(_clean_log_line(str(event["line"])), meta if meta else None)
        elif event.get("type") == "workflow":
            if on_workflow:
                on_workflow(event)
        elif event.get("type") == "chat":
            if on_chat:
                on_chat(event)
        elif event.get("type") == "result":
            result_payload = event
            workflow_graph = event.get("workflow_graph")

    exit_code = proc.wait()
    stderr_thread.join(timeout=1.0)
    stderr = "\n".join(stderr_lines)

    if result_payload:
        status = str(result_payload.get("status", "failed"))
        pr_url = result_payload.get("pr_url")
        error = result_payload.get("error")
        if isinstance(error, str):
            lowered = error.lower()
            if "connection refused" in lowered or "errno 61" in lowered:
                runtime_host = env.get("OPENHANDS_RUNTIME_HOST") or host
                runtime_hint = (
                    f"OpenHands runtime connection failed to {runtime_host}. "
                    "Start the runtime server, or unset OPENHANDS_RUNTIME_HOST to run locally."
                )
                if settings.openhands_require_remote_workspace:
                    runtime_hint += " OPENHANDS_REQUIRE_REMOTE_WORKSPACE is enabled."
                error = runtime_hint
        graph = result_payload.get("workflow_graph") or workflow_graph
        return (
            OpenHandsRunResult(
                status=status,
                pr_url=pr_url if pr_url else None,
                summary=result_payload.get("summary"),
                error=error,
            ),
            graph if isinstance(graph, dict) else None,
        )

    detail = stderr.strip()[-500:] if stderr.strip() else f"Agent process exited with code {exit_code}"
    lowered_detail = detail.lower()
    if "connection refused" in lowered_detail or "errno 61" in lowered_detail:
        runtime_host = env.get("OPENHANDS_RUNTIME_HOST") or host
        detail = (
            f"OpenHands runtime connection failed to {runtime_host}. "
            "Start the runtime server, or unset OPENHANDS_RUNTIME_HOST to run locally."
        )
        if settings.openhands_require_remote_workspace:
            detail += " OPENHANDS_REQUIRE_REMOTE_WORKSPACE is enabled."
    return (
        OpenHandsRunResult(
            status="failed",
            pr_url=None,
            summary=None,
            error=detail,
        ),
        None,
    )
