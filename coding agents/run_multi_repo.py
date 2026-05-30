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
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import asdict, dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv

from openhands_workspace import resolve_openhands_workspace

# LiteLLM logs a warning when botocore is absent (SageMaker/Bedrock streaming).
# We use the OpenAI-compatible GAP proxy only; suppress optional-provider noise.
os.environ.setdefault("LITELLM_LOG", "ERROR")

# Disable git's interactive pager. In the agent's non-interactive terminal,
# commands like `git diff` otherwise launch `less` and block until timeout.
os.environ["GIT_PAGER"] = "cat"
os.environ["PAGER"] = "cat"
os.environ.setdefault("GIT_TERMINAL_PROMPT", "0")

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "openai/ai-ops-gemini-2.5-flash"
DEFAULT_LLM_BASE_URL = "https://gap-dev.thoughtworks.net/v1"
RESULT_FILE = ".openhands_result.json"
PR_URL_RE = re.compile(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/\d+")


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


def format_openhands_event(event: Any) -> str | None:
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
        preview = text if len(text) <= 600 else text[:600] + "…"
        return f"[{role}] {preview}"
    if name == "ActionEvent":
        action = getattr(event, "action", None)
        kind = getattr(action, "kind", None) or type(action).__name__
        line = f"[action] {kind}"
        message = getattr(action, "message", None) if action else None
        if isinstance(message, str) and message.strip():
            msg = message.strip()
            if len(msg) > 400:
                msg = msg[:400] + "…"
            line += f": {msg}"
        return line
    if name == "ObservationEvent":
        obs = getattr(event, "observation", None)
        kind = getattr(obs, "kind", None) or type(obs).__name__
        text = str(obs).strip() if obs is not None else ""
        if len(text) > 500:
            text = text[:500] + "…"
        return f"[observation] {kind}" + (f" {text}" if text else "")
    text = str(event).strip()
    if not text or text == name:
        return None
    if len(text) > 500:
        text = text[:500] + "…"
    return f"[{name}] {text}"


def build_goal_prompt(goal: str, base_branch: str, feature_branch: str) -> str:
    return textwrap.dedent(
        f"""
        Work only inside the current repository and implement this goal:
        {goal}

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
    on_log: Callable[[str], None] | None = None,
    on_workflow: Callable[[dict[str, Any]], None] | None = None,
    openhands_sandbox: dict[str, Any] | None = None,
) -> tuple[RepoRunResult, dict[str, Any] | None]:
    """Run develop → review → test (cyclic) → deploy with per-role agent configs."""
    from workflow_orchestrator import RoleAgentSpec, run_implementation_workflow

    goal_slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", (goal_id or "adhoc").strip())[:48].strip("-") or "adhoc"
    workspace_parent = Path(tempfile.mkdtemp(prefix=f"openhands-goal-{goal_slug}-"))
    repo_dir = workspace_parent / "repo"
    repo_url = normalize_repo_url(repo_url)
    clone_url = auth_repo_url(repo_url, github_token)

    if github_token:
        os.environ["GITHUB_TOKEN"] = github_token
        os.environ["GH_TOKEN"] = github_token

    if on_log:
        if isinstance(openhands_sandbox, dict) and openhands_sandbox.get("kind"):
            mode = f"workflow sandbox ({openhands_sandbox.get('kind')})"
        else:
            mode = "remote Docker runtime" if (os.environ.get("OPENHANDS_RUNTIME_HOST") or "").strip() else "local"
        on_log(f"OpenHands per-goal workspace ({mode}): {workspace_parent}")

    try:
        if on_log:
            on_log(f"Cloning {repo_url} (branch {base_branch})…")
        clone_repo(clone_url, base_branch, repo_dir)
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
            on_log(f"Multi-agent workflow (model={model})")
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

        result, graph = run_implementation_workflow(
            repo_dir=repo_dir,
            goal=goal,
            base_branch=base_branch,
            feature_branch=feature_branch,
            model=model,
            api_key=api_key,
            roles=role_specs,
            max_cycles=max_cycles,
            pipeline_steps=pipeline_steps,
            on_log=on_log,
            on_workflow=on_workflow,
            openhands_sandbox=openhands_sandbox,
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
    on_log: Callable[[str], None] | None = None,
    openhands_sandbox: dict[str, Any] | None = None,
) -> RepoRunResult:
    def log(line: str) -> None:
        if on_log:
            on_log(line)

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
    workspace_parent = Path(tempfile.mkdtemp(prefix=f"openhands-goal-{goal_slug}-"))
    repo_dir = workspace_parent / "repo"
    repo_url = normalize_repo_url(repo_url)
    clone_url = auth_repo_url(repo_url, github_token)
    feature_branch = feature_branch_for_repo(repo_url, goal_id)

    if github_token:
        os.environ["GITHUB_TOKEN"] = github_token
        os.environ["GH_TOKEN"] = github_token

    if isinstance(openhands_sandbox, dict) and openhands_sandbox.get("kind"):
        mode = f"workflow sandbox ({openhands_sandbox.get('kind')})"
    else:
        mode = "remote Docker runtime" if (os.environ.get("OPENHANDS_RUNTIME_HOST") or "").strip() else "local"
    log(f"OpenHands per-goal workspace ({mode}): {workspace_parent}")

    try:
        clone_repo(clone_url, base_branch, repo_dir)
    except subprocess.CalledProcessError as exc:
        return RepoRunResult(
            repo=repo_url,
            status="clone_failed",
            pr_url=None,
            summary=None,
            workspace=str(workspace_parent),
            error=(exc.stderr or exc.stdout or str(exc)).strip()[-500:],
        )

    try:
        installed_skills: list[str] = []
        if skills:
            installed_skills = materialize_skills(repo_dir, skills)
            if installed_skills:
                log(f"Installed OpenHands skills: {', '.join(installed_skills)}")

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
            line = format_openhands_event(event)
            if line:
                log(line)

        workspace = resolve_openhands_workspace(repo_dir, openhands_sandbox)
        if isinstance(openhands_sandbox, dict) and openhands_sandbox.get("kind") == "docker":
            log(f"Using OpenHands RemoteWorkspace at {openhands_sandbox.get('runtime_host', '')}")
        elif isinstance(openhands_sandbox, dict) and openhands_sandbox.get("kind") == "remote":
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

        prompt = build_goal_prompt(goal, base_branch, feature_branch)
        try:
            conversation.send_message(prompt)
            conversation.run()
        finally:
            try:
                conversation.close()
            except Exception:
                pass
            try:
                workspace.__exit__(None, None, None)
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
