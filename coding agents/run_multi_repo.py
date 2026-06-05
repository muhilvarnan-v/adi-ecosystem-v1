#!/usr/bin/env python3
"""
Run one goal across multiple repositories with OpenHands SDK.

Example:
  export LLM_API_KEY=...
  export LLM_BASE_URL=https://your-litellm-host/v1
  export LLM_MODEL=openai/ai-ops-gemini-2.5-flash
  python run_multi_repo.py \
    --repo https://github.com/org/repo-a \
    --repo https://github.com/org/repo-b \
    --goal "Add /health endpoint and wire CI checks"
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv

from agent_log_context import current_workflow_agent_context, workflow_agent_context
from openhands_workspace import (
    activate_openhands_workspace,
    close_openhands_workspace,
    resolve_openhands_workspace,
)

# Log sink: optional second dict carries agent / phase / event_kind for structured UIs.
EmitLog = Callable[[str, dict[str, Any] | None], None]

# LiteLLM logs a warning when botocore is absent (SageMaker/Bedrock streaming).
# We use the OpenAI-compatible GAP proxy only; suppress optional-provider noise.
os.environ.setdefault("LITELLM_LOG", "ERROR")

# Disable git's interactive pager. In the agent's non-interactive terminal,
# commands like `git diff` otherwise launch `less` and block until timeout.
os.environ["GIT_PAGER"] = "cat"
os.environ["PAGER"] = "cat"
os.environ.setdefault("GIT_TERMINAL_PROMPT", "0")

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
WORKSPACE_ROOT = PROJECT_ROOT / ".openhands-workspaces"
DEFAULT_MODEL = "openai/ai-ops-gemini-2.5-flash"
DEFAULT_LLM_BASE_URL = "https://gap-dev.thoughtworks.net/v1"
RESULT_FILE = ".openhands_result.json"
PR_URL_RE = re.compile(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/\d+")
REPO_BRIEF_MAX_CHARS = 8000


def import_openhands_sdk() -> tuple[Any, Any, Any, Any, Any, Any, Any]:
    try:
        from openhands.sdk import Agent, Conversation, LLM, Tool
        from openhands.sdk.context import AgentContext
        from openhands.tools.file_editor import FileEditorTool
        from openhands.tools.task_tracker import TaskTrackerTool
        from openhands.tools.terminal import TerminalTool
    except ModuleNotFoundError:
        print(
            "Missing OpenHands dependencies.\n"
            "Install with:\n"
            "  pip install -r \"coding agents/requirements.txt\"\n",
            file=sys.stderr,
        )
        sys.exit(1)
    return Agent, Conversation, LLM, Tool, FileEditorTool, TaskTrackerTool, TerminalTool, AgentContext


@dataclass
class RepoRunResult:
    repo: str
    status: str
    pr_url: str | None
    summary: str | None
    workspace: str | None
    error: str | None = None


def _ensure_mount_writable(path: Path) -> None:
    """Relax permissions so Docker runtime users can write bind-mounted repos."""
    try:
        current_user = (os.environ.get("USER") or os.environ.get("LOGNAME") or "").strip()
        if current_user:
            subprocess.run(
                ["chmod", "-R", "u+rwX", str(path)],
                check=False,
                capture_output=True,
                text=True,
                timeout=45,
            )
        subprocess.run(
            [
                "chmod",
                "-R",
                "+a",
                "openhands allow read,write,execute,add_file,add_subdirectory,delete,delete_child,file_inherit,directory_inherit",
                str(path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=45,
        )
        subprocess.run(
            ["chmod", "-R", "a+rwX", str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=45,
        )
    except Exception:
        # Non-fatal: diagnostics in workflow_orchestrator will surface mount issues.
        pass


@contextmanager
def _repo_cwd(repo_dir: Path):
    """Run OpenHands operations from repo cwd so SDK git probes see .git."""
    previous = Path.cwd()
    changed = False
    try:
        os.chdir(repo_dir)
        changed = True
    except Exception:
        changed = False
    try:
        yield
    finally:
        if changed:
            try:
                os.chdir(previous)
            except Exception:
                pass


def create_project_workspace(goal_slug: str) -> Path:
    """Create a project-local workspace directory for a run."""
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    workspace_name = f"openhands-goal-{goal_slug}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    workspace_parent = WORKSPACE_ROOT / workspace_name
    workspace_parent.mkdir(parents=True, exist_ok=False)
    _ensure_mount_writable(workspace_parent)
    return workspace_parent


def load_env() -> None:
    load_dotenv(ROOT / ".env")


def normalize_openai_compatible_api_base(url: str) -> str:
    """Ensure host-only OpenAI-compatible bases end with ``/v1``.

    The OpenAI Python client appends paths such as ``/chat/completions`` to
    ``base_url``. If ``base_url`` is only ``https://host`` (no path), requests
    go to ``https://host/chat/completions`` instead of ``https://host/v1/chat/completions``,
    which many LiteLLM / reverse-proxy setups answer with **403** and a tiny HTML page.

    If the URL already has a non-root path (e.g. ``/custom-gateway``), it is left unchanged.
    """
    t = (url or "").strip().rstrip("/")
    if not t:
        return t
    parsed = urlparse(t)
    path = (parsed.path or "").rstrip("/")
    if path == "":
        return f"{t}/v1"
    if path.endswith("/v1"):
        return t
    return t


def require_api_key() -> str:
    load_env()
    api_key = (os.environ.get("LLM_API_KEY") or "").strip()
    if not api_key:
        print(
            "Missing LLM_API_KEY.\n"
            "Set it in coding agents/.env or with:\n"
            "  export LLM_API_KEY=...\n",
            file=sys.stderr,
        )
        sys.exit(1)
    return api_key


def resolve_llm_base_url() -> str:
    """LiteLLM / OpenAI-compatible API base (OpenHands passes this to litellm as api_base)."""
    load_env()
    raw = (os.environ.get("LLM_BASE_URL") or DEFAULT_LLM_BASE_URL).strip()
    return normalize_openai_compatible_api_base(raw)


def resolve_llm_model(cli_model: str | None = None) -> str:
    load_env()
    if cli_model:
        return cli_model.strip()
    return (os.environ.get("LLM_MODEL") or DEFAULT_MODEL).strip()


def build_llm(model: str, api_key: str, *, base_url: str | None = None):
    """Create an OpenHands LLM wired to LiteLLM (or another OpenAI-compatible base).

    When ``base_url`` is omitted or empty, uses ``LLM_BASE_URL`` / ``.env`` / code default.
    Per-agent profile URLs should be passed here instead of mutating ``os.environ`` so
    multi-phase workflows do not reuse the previous phase's gateway by mistake.
    """
    _, _, LLM, _, _, _, _, _ = import_openhands_sdk()
    explicit = (base_url or "").strip()
    if explicit:
        resolved = normalize_openai_compatible_api_base(explicit)
    else:
        resolved = resolve_llm_base_url()
    return LLM(
        model=model,
        api_key=api_key,
        base_url=resolved,
    )


def normalize_repo_url(url: str) -> str:
    repo = url.strip().rstrip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not repo.startswith("https://github.com/"):
        raise ValueError(f"Only GitHub HTTPS URLs are supported: {url}")
    parts = repo.replace("https://github.com/", "").split("/")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f"Invalid GitHub repo URL: {url}")
    return repo


def read_repo_file(path: str) -> list[str]:
    raw = Path(path).read_text(encoding="utf-8")
    if path.endswith(".json"):
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("--repos-file JSON must be an array of repo URLs")
        return [str(item).strip() for item in data if str(item).strip()]
    return [line.strip() for line in raw.splitlines() if line.strip() and not line.startswith("#")]


def collect_repos(args: argparse.Namespace) -> list[str]:
    repos: list[str] = []
    for repo in args.repo or []:
        repos.append(repo)
    if args.repos_file:
        repos.extend(read_repo_file(args.repos_file))
    if not repos:
        raise ValueError("Provide at least one repo via --repo or --repos-file")

    normalized: list[str] = []
    seen: set[str] = set()
    for repo in repos:
        url = normalize_repo_url(repo)
        if url not in seen:
            seen.add(url)
            normalized.append(url)
    return normalized


def auth_repo_url(repo_url: str, github_token: str | None) -> str:
    if not github_token:
        return repo_url
    return repo_url.replace(
        "https://github.com/",
        f"https://x-access-token:{github_token}@github.com/",
        1,
    )


def feature_branch_for_repo(repo_url: str, goal_id: str | None = None) -> str:
    slug = repo_url.replace("https://github.com/", "").replace("/", "-")
    if goal_id:
        return f"openhands/{slug}-{goal_id[:8]}"[:120]
    return f"openhands/{slug}"[:120]


def _truncate(s: str, max_len: int) -> str:
    s = s.strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def openhands_event_meta(event: Any) -> dict[str, Any] | None:
    """Map an OpenHands stream event to structured log fields (preview + kind)."""
    name = type(event).__name__
    if name == "MessageEvent":
        role = getattr(getattr(event, "llm_message", None), "role", "?")
        message = getattr(event, "llm_message", None)
        content = getattr(message, "content", None) if message else None
        if isinstance(content, str) and content.strip():
            text = content.strip()
        elif isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    text_part = block.get("text")
                    if text_part:
                        parts.append(str(text_part))
                else:
                    text_part = getattr(block, "text", None)
                    if text_part:
                        parts.append(str(text_part))
            text = "\n".join(parts).strip()
        else:
            text = str(event).strip()
        if not text:
            return None
        return {
            "event_kind": "llm_message",
            "message_role": str(role),
            "preview": _truncate(text, 600),
        }
    if name == "ActionEvent":
        action = getattr(event, "action", None)
        kind = getattr(action, "kind", None) or (type(action).__name__ if action else "action")
        parts = [str(kind)]
        message = getattr(action, "message", None) if action else None
        if isinstance(message, str) and message.strip():
            parts.append(_truncate(message.strip(), 400))
        preview = " — ".join(parts) if len(parts) > 1 else parts[0]
        return {
            "event_kind": "tool_action",
            "action_type": str(kind),
            "preview": preview,
        }
    if name == "ObservationEvent":
        obs = getattr(event, "observation", None)
        okind = getattr(obs, "kind", None) or (type(obs).__name__ if obs else "observation")
        text = str(obs).strip() if obs is not None else ""
        preview = _truncate(text, 500) if text else str(okind)
        return {
            "event_kind": "observation",
            "observation_kind": str(okind),
            "preview": preview,
        }
    text = str(event).strip()
    if not text or text == name:
        return None
    return {
        "event_kind": "system",
        "preview": _truncate(text, 500),
    }


def log_line_prefix(merged: dict[str, Any]) -> str:
    """Build a short bracket prefix: who is acting + what kind of event."""
    agent = str(merged.get("agent") or "").strip()
    phase = str(merged.get("phase") or "").strip()
    cycle = merged.get("cycle")
    event_kind = str(merged.get("event_kind") or "").strip()

    scope: list[str] = []
    if agent:
        scope.append(agent)
    elif event_kind == "orchestrator":
        scope.append("Harness")
    elif event_kind == "workflow":
        scope.append("Workflow")

    if phase and phase != "goal":
        scope.append(phase)
    if cycle is not None and phase and phase != "goal":
        try:
            scope.append(f"c{int(cycle)}")
        except (TypeError, ValueError):
            pass

    kind_label = ""
    if event_kind == "llm_message":
        role = str(merged.get("message_role") or "message").strip()
        kind_label = f"message:{role}"
    elif event_kind == "tool_action":
        kind_label = f"action:{str(merged.get('action_type') or 'tool').strip()}"
    elif event_kind == "observation":
        kind_label = f"observe:{str(merged.get('observation_kind') or '?').strip()}"
    elif event_kind == "orchestrator":
        kind_label = "setup"
    elif event_kind == "workflow":
        kind_label = "workflow"
    elif event_kind == "system":
        kind_label = "event"

    left = " · ".join(scope) if scope else "log"
    if kind_label:
        return f"[{left} | {kind_label}]"
    return f"[{left}]"


def compose_structured_log(
    wf_ctx: dict[str, Any],
    event_meta: dict[str, Any],
) -> tuple[str, str, dict[str, Any]]:
    """Return (full_line, body, merged_meta) for NDJSON / persistence."""
    merged: dict[str, Any] = {**wf_ctx, **event_meta}
    body = str(merged.get("preview") or "").strip()
    prefix = log_line_prefix(merged)
    full = f"{prefix} {body}".strip() if body else prefix
    return full, body, merged


def slim_log_fields(merged: dict[str, Any], body: str) -> dict[str, Any]:
    keys = (
        "agent",
        "phase",
        "cycle",
        "agent_record_id",
        "event_kind",
        "message_role",
        "action_type",
        "observation_kind",
        "preview",
    )
    slim: dict[str, Any] = {k: merged[k] for k in keys if k in merged and merged[k] is not None}
    if body:
        slim["body"] = body
    return slim


def emit_harness_log(
    on_log: EmitLog | None,
    message: str,
    *,
    event_kind: str = "orchestrator",
    **wf_fields: Any,
) -> None:
    """Log a harness / setup line with optional workflow context."""
    if not on_log:
        return
    wf = {**current_workflow_agent_context(), **wf_fields}
    full, body, merged = compose_structured_log(wf, {"event_kind": event_kind, "preview": message})
    on_log(full, slim_log_fields(merged, body))


def format_openhands_event(event: Any) -> str | None:
    """Plain string for callers that only need one line (tests, legacy)."""
    meta = openhands_event_meta(event)
    if not meta:
        return None
    full, _, _ = compose_structured_log(current_workflow_agent_context(), meta)
    return full


def build_repo_explain_prompt(repo_url: str, base_branch: str) -> str:
    return textwrap.dedent(
        f"""
        You are an expert software engineer. The repository at {repo_url}
        (branch: {base_branch}) has already been cloned into your working directory.

        Your task:
        1. Run `ls -la` to inspect top-level files.
        2. Read README and key source entry points.
        3. Summarize architecture, key modules, and how the project is typically used.

        Keep it concise and factual. Do NOT create, modify, or commit any files.
        """
    ).strip()


def _message_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict):
            text = block.get("text")
        else:
            text = getattr(block, "text", None)
        if text:
            parts.append(str(text).strip())
    return "\n".join(part for part in parts if part).strip()


def _extract_last_assistant_message(events: list[Any]) -> str | None:
    for event in reversed(events):
        if type(event).__name__ != "MessageEvent":
            continue
        message = getattr(event, "llm_message", None)
        role = str(getattr(message, "role", "")).strip().lower() if message else ""
        if role != "assistant":
            continue
        text = _message_content_to_text(getattr(message, "content", None))
        if text:
            return text
    return None


def run_repository_recon(
    *,
    repo_url: str,
    base_branch: str,
    repo_dir: Path,
    model: str,
    api_key: str,
    openhands_sandbox: dict[str, Any] | None,
    on_log: EmitLog | None,
) -> str | None:
    (
        Agent,
        Conversation,
        _,
        Tool,
        FileEditorTool,
        _,
        TerminalTool,
        _,
    ) = import_openhands_sdk()

    with workflow_agent_context(agent="Repo scout", phase="goal", cycle=0):
        emit_harness_log(
            on_log,
            "Running repository reconnaissance in OpenHands workspace…",
        )

        llm = build_llm(model=model, api_key=api_key)
        agent = Agent(
            llm=llm,
            tools=[
                Tool(name=TerminalTool.name),
                Tool(name=FileEditorTool.name),
            ],
        )

        def event_callback(event: Any) -> None:
            meta = openhands_event_meta(event)
            if not meta or not on_log:
                return
            full, body, merged = compose_structured_log(current_workflow_agent_context(), meta)
            on_log(full, slim_log_fields(merged, body))

        with _repo_cwd(repo_dir):
            raw_workspace = resolve_openhands_workspace(repo_dir, openhands_sandbox)
            workspace, workspace_handle = activate_openhands_workspace(raw_workspace)
            conversation = Conversation(
                agent=agent,
                workspace=workspace,
                callbacks=[event_callback],
                visualizer=None,
            )
            prompt = build_repo_explain_prompt(repo_url, base_branch)
            try:
                conversation.send_message(prompt)
                conversation.run()
            finally:
                try:
                    conversation.close()
                except Exception:
                    pass
                try:
                    close_openhands_workspace(workspace_handle)
                except Exception:
                    pass

        state = getattr(conversation, "state", None)
        events = getattr(state, "events", []) if state is not None else []
        summary = _extract_last_assistant_message(list(events))
        if summary:
            trimmed = summary.strip()
            if len(trimmed) > REPO_BRIEF_MAX_CHARS:
                trimmed = trimmed[:REPO_BRIEF_MAX_CHARS].rstrip() + "\n..."
            emit_harness_log(on_log, "Repository reconnaissance completed.")
            return trimmed

        emit_harness_log(on_log, "Repository reconnaissance produced no assistant summary.")
        return None


def build_goal_prompt(
    goal: str,
    base_branch: str,
    feature_branch: str,
    repo_summary: str | None = None,
) -> str:
    repo_context = ""
    if repo_summary:
        repo_context = textwrap.dedent(
            f"""

            Repository reconnaissance summary (generated in this workspace):
            {repo_summary}

            Use this summary as context, but verify any critical details against the repository before finalizing changes.
            """
        ).rstrip()

    return textwrap.dedent(
        f"""
        Work only inside the current repository and implement this goal:
        {goal}

        {repo_context}

        Required workflow:
        1. Inspect the codebase and determine minimal safe changes.
        2. Create branch `{feature_branch}` from `{base_branch}`.
        3. Implement production-quality changes and update/add tests as needed.
        4. Run relevant validations for the repo and fix issues you introduce.
        5. Commit, push branch, and open a PR into `{base_branch}`.

        After finishing, write `{RESULT_FILE}` in the repo root with this JSON shape:
        {{
          "status": "finished" | "failed",
          "pr_url": "<url or NONE>",
          "summary": "<single line summary>"
        }}

        Also end your final response with:
        PR_URL: <url or NONE>
        SUMMARY: <single line>
        """
    ).strip()


def parse_result_file(path: Path) -> tuple[str, str | None, str | None]:
    if not path.exists():
        return ("failed", None, f"Missing {RESULT_FILE}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return ("failed", None, f"Invalid JSON in {RESULT_FILE}: {exc}")

    status = str(payload.get("status", "failed")).strip() or "failed"
    pr_url_raw = str(payload.get("pr_url", "")).strip()
    pr_url = None if not pr_url_raw or pr_url_raw.upper() == "NONE" else pr_url_raw
    summary = str(payload.get("summary", "")).strip() or None
    return status, pr_url, summary


def extract_pr_from_text(text: str) -> str | None:
    marker = re.search(r"PR_URL:\s*(\S+)", text)
    if marker:
        value = marker.group(1).strip()
        if value.upper() != "NONE":
            return value
    match = PR_URL_RE.search(text)
    return match.group(0) if match else None


def clone_repo(repo_url: str, base_branch: str, target_dir: Path) -> None:
    subprocess.run(
        ["git", "clone", "--branch", base_branch, "--single-branch", repo_url, str(target_dir)],
        check=True,
        capture_output=True,
        text=True,
    )
    # Keep agent bookkeeping files out of the application repo's commits/PRs.
    # Uses .git/info/exclude (local, never committed) so even `git add -A` skips them.
    try:
        exclude = target_dir / ".git" / "info" / "exclude"
        exclude.parent.mkdir(parents=True, exist_ok=True)
        existing = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
        patterns = [".openhands_result.json", ".openhands_phase_result.json", ".openhands*"]
        to_add = [p for p in patterns if p not in existing]
        if to_add:
            with exclude.open("a", encoding="utf-8") as fh:
                if existing and not existing.endswith("\n"):
                    fh.write("\n")
                fh.write("\n".join(to_add) + "\n")
    except Exception:
        pass  # non-fatal; agent prompts are also instructed not to commit these


def _effective_openhands_sandbox(
    openhands_sandbox: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Resolve sandbox mode for execution.

    If callers did not provide a workflow sandbox but the legacy
    OPENHANDS_RUNTIME_HOST points at localhost, prefer a per-run DockerWorkspace
    so the cloned repo can be mounted into the runtime container.
    """
    if isinstance(openhands_sandbox, dict) and openhands_sandbox.get("kind"):
        return openhands_sandbox

    host = (os.environ.get("OPENHANDS_RUNTIME_HOST") or "").strip().rstrip("/")
    if not host:
        return None

    parsed = urlparse(host)
    hostname = (parsed.hostname or "").strip().lower()
    if hostname not in {"127.0.0.1", "localhost"}:
        return None

    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme == "https" else 80

    sandbox: dict[str, Any] = {
        "kind": "docker",
        "host_port": int(port),
    }
    image = (os.environ.get("OPENHANDS_DOCKER_SERVER_IMAGE") or "").strip()
    if image:
        sandbox["server_image"] = image
    return sandbox


def run_workflow_for_repo(
    *,
    repo_url: str,
    goal: str,
    api_key: str,
    model: str,
    base_branch: str,
    feature_branch: str,
    roles: dict[str, Any],
    max_cycles: int = 3,
    pipeline_steps: list[str] | None = None,
    stream: bool = False,
    keep_workspaces: bool = False,
    goal_id: str | None = None,
    github_token: str | None = None,
    on_log: EmitLog | None = None,
    on_workflow: Callable[[dict[str, Any]], None] | None = None,
    on_chat: Callable[[dict[str, Any]], None] | None = None,
    openhands_sandbox: dict[str, Any] | None = None,
) -> tuple[RepoRunResult, dict[str, Any] | None]:
    """Run develop → review → test (cyclic) → deploy with per-role agent configs."""
    from workflow_orchestrator import RoleAgentSpec, run_implementation_workflow

    goal_slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (goal_id or "adhoc").strip())[:48].strip("-") or "adhoc"
    workspace_parent = create_project_workspace(goal_slug)
    repo_dir = workspace_parent / "repo"
    repo_url = normalize_repo_url(repo_url)
    clone_url = auth_repo_url(repo_url, github_token)

    if github_token:
        os.environ["GITHUB_TOKEN"] = github_token
        os.environ["GH_TOKEN"] = github_token

    effective_sandbox = _effective_openhands_sandbox(openhands_sandbox)

    if on_log:
        if isinstance(effective_sandbox, dict) and effective_sandbox.get("kind"):
            mode = f"workflow sandbox ({effective_sandbox.get('kind')})"
        else:
            mode = "remote Docker runtime" if (os.environ.get("OPENHANDS_RUNTIME_HOST") or "").strip() else "local"
        emit_harness_log(on_log, f"OpenHands per-goal workspace ({mode}): {workspace_parent}")

    try:
        if on_log:
            emit_harness_log(on_log, f"Cloning {repo_url} (branch {base_branch})…")
        clone_repo(clone_url, base_branch, repo_dir)
        _ensure_mount_writable(repo_dir)
    except subprocess.CalledProcessError as exc:
        return (
            RepoRunResult(
                repo=repo_url,
                status="clone_failed",
                pr_url=None,
                summary=None,
                workspace=str(workspace_parent),
                error=(exc.stderr or exc.stdout or str(exc)).strip()[-500:],
            ),
            None,
        )

    try:
        if on_log:
            emit_harness_log(on_log, f"Multi-agent workflow (model={model})")
        role_specs: dict[str, RoleAgentSpec] = {}
        for role_key, spec in roles.items():
            role_specs[role_key] = RoleAgentSpec(
                role=role_key,
                agent_record_id=str(spec.get("agent_record_id", "")),
                display_name=str(spec.get("display_name", role_key)),
                system_instruction=str(spec.get("system_instruction", "")),
                skills=list(spec.get("skills") or []),
                mcp_servers=list(spec.get("mcp_servers") or []),
                openhands_settings=dict(spec.get("openhands_settings") or {}),
            )

        repo_summary = run_repository_recon(
            repo_url=repo_url,
            base_branch=base_branch,
            repo_dir=repo_dir,
            model=model,
            api_key=api_key,
            openhands_sandbox=effective_sandbox,
            on_log=on_log,
        )
        goal_with_context = goal
        if repo_summary:
            goal_with_context = (
                f"{goal}\n\n"
                "Repository reconnaissance summary (generated before implementation):\n"
                f"{repo_summary}\n\n"
                "Use this summary as context and validate against files before making changes."
            )

        result, graph = run_implementation_workflow(
            repo_dir=repo_dir,
            goal=goal_with_context,
            base_branch=base_branch,
            feature_branch=feature_branch,
            model=model,
            api_key=api_key,
            roles=role_specs,
            max_cycles=max_cycles,
            pipeline_steps=pipeline_steps,
            on_log=on_log,
            on_workflow=on_workflow,
            on_chat=on_chat,
            openhands_sandbox=effective_sandbox,
        )
        result.repo = repo_url
        if stream:
            print(f"\n--- Workflow completed {repo_url} ---", file=sys.stderr)
        return result, graph.to_dict()
    except Exception as exc:  # noqa: BLE001
        return (
            RepoRunResult(
                repo=repo_url,
                status="exception",
                pr_url=None,
                summary=None,
                workspace=str(workspace_parent),
                error=str(exc),
            ),
            None,
        )
    finally:
        if not keep_workspaces:
            shutil.rmtree(workspace_parent, ignore_errors=True)


def run_for_repo(
    *,
    repo_url: str,
    goal: str,
    api_key: str,
    model: str,
    base_branch: str,
    stream: bool = False,
    keep_workspaces: bool = False,
    goal_id: str | None = None,
    github_token: str | None = None,
    skills: list[dict[str, Any]] | None = None,
    on_log: EmitLog | None = None,
    openhands_sandbox: dict[str, Any] | None = None,
) -> RepoRunResult:
    def log(line: str, meta: dict[str, Any] | None = None) -> None:
        if not on_log:
            return
        if meta is None:
            emit_harness_log(on_log, line)
        else:
            on_log(line, meta)

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
    from skills_setup import materialize_skills

    goal_slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (goal_id or "adhoc").strip())[:48].strip("-") or "adhoc"
    workspace_parent = create_project_workspace(goal_slug)
    repo_dir = workspace_parent / "repo"
    repo_url = normalize_repo_url(repo_url)
    clone_url = auth_repo_url(repo_url, github_token)
    feature_branch = feature_branch_for_repo(repo_url, goal_id)

    if github_token:
        os.environ["GITHUB_TOKEN"] = github_token
        os.environ["GH_TOKEN"] = github_token

    effective_sandbox = _effective_openhands_sandbox(openhands_sandbox)

    if isinstance(effective_sandbox, dict) and effective_sandbox.get("kind"):
        mode = f"workflow sandbox ({effective_sandbox.get('kind')})"
    else:
        mode = "remote Docker runtime" if (os.environ.get("OPENHANDS_RUNTIME_HOST") or "").strip() else "local"
    log(f"OpenHands per-goal workspace ({mode}): {workspace_parent}")

    try:
        clone_repo(clone_url, base_branch, repo_dir)
        _ensure_mount_writable(repo_dir)
    except subprocess.CalledProcessError as exc:
        return RepoRunResult(
            repo=repo_url,
            status="clone_failed",
            pr_url=None,
            summary=None,
            workspace=str(workspace_parent),
            error=(exc.stderr or exc.stdout or str(exc)).strip()[-500:],
        )

    with workflow_agent_context(agent="Coding agent", phase="goal", cycle=0):
        try:
            installed_skills: list[str] = []
            if skills:
                installed_skills = materialize_skills(repo_dir, skills)
                if installed_skills:
                    log(f"Installed OpenHands skills: {', '.join(installed_skills)}")

            repo_summary = run_repository_recon(
                repo_url=repo_url,
                base_branch=base_branch,
                repo_dir=repo_dir,
                model=model,
                api_key=api_key,
                openhands_sandbox=effective_sandbox,
                on_log=on_log,
            )

            log(f"Starting OpenHands agent (model={model})…")
            llm = build_llm(model=model, api_key=api_key)
            agent_context = (
                AgentContext(load_project_skills=True) if installed_skills else None
            )
            agent = Agent(
                llm=llm,
                agent_context=agent_context,
                tools=[
                    Tool(name=TerminalTool.name),
                    Tool(name=FileEditorTool.name),
                    Tool(name=TaskTrackerTool.name),
                ],
            )

            def event_callback(event: Any) -> None:
                meta = openhands_event_meta(event)
                if not meta:
                    return
                full, body, merged = compose_structured_log(current_workflow_agent_context(), meta)
                log(full, slim_log_fields(merged, body))

            with _repo_cwd(repo_dir):
                raw_workspace = resolve_openhands_workspace(repo_dir, effective_sandbox)
                workspace, workspace_handle = activate_openhands_workspace(raw_workspace)
                if isinstance(effective_sandbox, dict) and effective_sandbox.get("kind") == "docker":
                    log("Using OpenHands DockerWorkspace (local Docker sandbox).")
                elif isinstance(effective_sandbox, dict) and effective_sandbox.get("kind") == "remote":
                    log("Using OpenHands APIRemoteWorkspace (hosted runtime API).")
                elif os.environ.get("OPENHANDS_RUNTIME_HOST", "").strip():
                    log("Using OpenHands RemoteWorkspace (Docker runtime server).")
                else:
                    log(f"Using OpenHands LocalWorkspace at {repo_dir}")

                conversation = Conversation(
                    agent=agent,
                    workspace=workspace,
                    callbacks=[event_callback],
                    visualizer=None,
                )

                prompt = build_goal_prompt(
                    goal,
                    base_branch,
                    feature_branch,
                    repo_summary=repo_summary,
                )
                try:
                    conversation.send_message(prompt)
                    conversation.run()
                finally:
                    try:
                        conversation.close()
                    except Exception:
                        pass
                    try:
                        close_openhands_workspace(workspace_handle)
                    except Exception:
                        pass

            state = getattr(conversation, "state", None)
            events = getattr(state, "events", []) if state is not None else []
            output_text = "\n".join(str(event) for event in events[-8:])

            status, pr_url, summary = parse_result_file(repo_dir / RESULT_FILE)
            pr_from_text = extract_pr_from_text(output_text)
            if not pr_url and pr_from_text:
                pr_url = pr_from_text
            if not summary:
                summary = f"Goal executed on {repo_url}"

            if stream:
                print(f"\n--- Completed {repo_url} ---", file=sys.stderr)

            finished = status == "finished" and pr_url is not None
            if finished:
                log(f"Agent finished. PR: {pr_url}")
            return RepoRunResult(
                repo=repo_url,
                status="finished" if finished else "failed",
                pr_url=pr_url,
                summary=summary,
                workspace=str(workspace_parent),
                error=None if finished else output_text[-500:] or "run failed",
            )
        except Exception as exc:  # noqa: BLE001
            return RepoRunResult(
                repo=repo_url,
                status="exception",
                pr_url=None,
                summary=None,
                workspace=str(workspace_parent),
                error=str(exc),
            )
        finally:
            if not keep_workspaces:
                shutil.rmtree(workspace_parent, ignore_errors=True)


def print_human_report(results: list[RepoRunResult]) -> None:
    print("\nMulti-repo run report:")
    for item in results:
        print(f"\nRepo:      {item.repo}")
        print(f"Status:    {item.status}")
        print(f"PR URL:    {item.pr_url or '-'}")
        if item.summary:
            print(f"Summary:   {item.summary}")
        if item.workspace:
            print(f"Workspace: {item.workspace}")
        if item.error:
            print(f"Error:     {item.error}")


def save_json_report(path: str, results: list[RepoRunResult]) -> None:
    payload = [asdict(item) for item in results]
    Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Execute one goal over multiple GitHub repos using OpenHands SDK"
    )
    parser.add_argument("--repo", action="append", default=[], help="GitHub repository URL; repeatable")
    parser.add_argument(
        "--repos-file",
        default="",
        help="Path to newline or JSON list file containing repo URLs",
    )
    parser.add_argument("--goal", default="", help="Goal statement for all repos")
    parser.add_argument("--base-branch", default="main", help="Branch to start from")
    parser.add_argument(
        "--model",
        default=None,
        help=f"LiteLLM model id (default: LLM_MODEL env or {DEFAULT_MODEL})",
    )
    parser.add_argument("--stream", action="store_true", help="Print per-repo completion updates")
    parser.add_argument("--dry-run", action="store_true", help="Validate input and print prompt preview")
    parser.add_argument(
        "--keep-workspaces",
        action="store_true",
        help="Keep temporary cloned repositories after runs",
    )
    parser.add_argument("--json-out", default="", help="Optional path to write machine-readable JSON results")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.goal.strip():
        print("--goal is required", file=sys.stderr)
        sys.exit(2)

    repos = collect_repos(args)
    print(f"Repos: {len(repos)}")
    for repo in repos:
        print(f" - {repo}")
    model = resolve_llm_model(args.model)
    print(f"Model: {model}")
    print(f"LiteLLM base URL: {resolve_llm_base_url()}")
    print(f"Base branch: {args.base_branch}")

    if args.dry_run:
        print("\nPrompt preview:\n")
        print(build_goal_prompt(args.goal, args.base_branch, "openhands/owner-repo"))
        return

    api_key = require_api_key()
    results: list[RepoRunResult] = []
    for idx, repo_url in enumerate(repos, start=1):
        print(f"\n[{idx}/{len(repos)}] Running goal on {repo_url}", file=sys.stderr)
        result = run_for_repo(
            repo_url=repo_url,
            goal=args.goal,
            api_key=api_key,
            model=model,
            base_branch=args.base_branch,
            stream=args.stream,
            keep_workspaces=args.keep_workspaces,
        )
        results.append(result)

    print_human_report(results)
    if args.json_out:
        save_json_report(args.json_out, results)
        print(f"\nJSON report written to: {args.json_out}")

    failures = [item for item in results if item.status != "finished"]
    if failures:
        sys.exit(2)


if __name__ == "__main__":
    main()
