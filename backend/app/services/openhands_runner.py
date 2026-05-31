"""Invoke the coding agents OpenHands runner in an isolated venv (avoids pip conflicts)."""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from app.config import Settings

LogCallback = Callable[[str, dict[str, Any] | None], None]
WorkflowCallback = Callable[[dict], None]
ChatCallback = Callable[[dict], None]

_AID_ROOT = Path(__file__).resolve().parents[3]
_CODING_AGENTS_DIR = _AID_ROOT / "coding agents"
_RUN_GOAL_SCRIPT = _CODING_AGENTS_DIR / "run_goal.py"
_DEFAULT_PYTHON = _CODING_AGENTS_DIR / ".venv" / "bin" / "python"


@dataclass
class OpenHandsRunResult:
    status: str
    pr_url: str | None
    summary: str | None
    error: str | None = None


def _resolve_python() -> Path:
    override = (os.environ.get("CODING_AGENTS_PYTHON") or "").strip()
    if override:
        return Path(override)
    if _DEFAULT_PYTHON.is_file():
        return _DEFAULT_PYTHON
    return Path(os.environ.get("PYTHON", "python3"))


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
    if openhands_sandbox:
        # Workflow-scoped sandbox overrides global runtime env for this subprocess.
        env.pop("OPENHANDS_RUNTIME_HOST", None)
        env.pop("OPENHANDS_RUNTIME_API_KEY", None)
    host = (settings.openhands_runtime_host or "").strip()
    if host and not openhands_sandbox:
        env["OPENHANDS_RUNTIME_HOST"] = host
    rt_key = (settings.openhands_runtime_api_key or "").strip()
    if rt_key and not openhands_sandbox:
        env["OPENHANDS_RUNTIME_API_KEY"] = rt_key
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
    proc.stdin.write(json.dumps(payload))
    proc.stdin.close()

    result_payload: dict | None = None
    workflow_graph: dict | None = None
    for raw_line in proc.stdout:
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
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
                meta = {k: event[k] for k in meta_keys if k in event and event[k] is not None}
                on_log(str(event["line"]), meta if meta else None)
        elif event.get("type") == "workflow":
            if on_workflow:
                on_workflow(event)
        elif event.get("type") == "chat":
            if on_chat:
                on_chat(event)
        elif event.get("type") == "result":
            result_payload = event
            workflow_graph = event.get("workflow_graph")

    stderr = proc.stderr.read() if proc.stderr else ""
    exit_code = proc.wait()

    if result_payload:
        status = str(result_payload.get("status", "failed"))
        pr_url = result_payload.get("pr_url")
        graph = result_payload.get("workflow_graph") or workflow_graph
        return (
            OpenHandsRunResult(
                status=status,
                pr_url=pr_url if pr_url else None,
                summary=result_payload.get("summary"),
                error=result_payload.get("error"),
            ),
            graph if isinstance(graph, dict) else None,
        )

    detail = stderr.strip()[-500:] if stderr.strip() else f"Agent process exited with code {exit_code}"
    return (
        OpenHandsRunResult(
            status="failed",
            pr_url=None,
            summary=None,
            error=detail,
        ),
        None,
    )
