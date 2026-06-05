#!/usr/bin/env python3
"""
Simple test: clone a public GitHub repo into a Docker workspace and
ask an OpenHands agent to explain the codebase.

Usage:
    export LLM_API_KEY=your-key-here
    # Optional overrides (defaults to the GAP proxy + Gemini Flash):
    export LLM_BASE_URL=https://gap-dev.thoughtworks.net/v1
    export LLM_MODEL=openai/ai-ops-gemini-2.5-flash

    cd "coding agents"
    python test_explain_repo.py

    # Or point at a different repo:
    python test_explain_repo.py --repo https://github.com/pallets/click
"""

from __future__ import annotations

import argparse
import inspect
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# ── resolve project root / .env ───────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

# ── defaults ──────────────────────────────────────────────────────────────────
DEFAULT_REPO = "https://github.com/pallets/click"   # small, well-known Python lib
DEFAULT_BRANCH = "main"
DEFAULT_MODEL = "openai/ai-ops-gemini-2.5-flash"
DEFAULT_BASE_URL = "https://gap-dev.thoughtworks.net/v1"
DEFAULT_SERVER_IMAGE = "ghcr.io/openhands/agent-server:latest-python"


# ── helpers ───────────────────────────────────────────────────────────────────

def require_api_key() -> str:
    key = (os.environ.get("LLM_API_KEY") or "").strip()
    if not key:
        sys.exit(
            "ERROR: LLM_API_KEY is not set.\n"
            "  export LLM_API_KEY=your-key\n"
            "  or add it to coding agents/.env"
        )
    return key


def resolve_base_url() -> str:
    raw = (os.environ.get("LLM_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")
    from urllib.parse import urlparse
    parsed = urlparse(raw)
    if not (parsed.path or "").rstrip("/"):
        return f"{raw}/v1"
    return raw


def clone_repo(repo_url: str, branch: str, target: Path) -> None:
    print(f"\n[clone] Cloning {repo_url} (branch={branch}) → {target}")
    subprocess.run(
        ["git", "clone", "--branch", branch, "--single-branch", "--depth", "1",
         repo_url, str(target)],
        check=True,
    )


def resolve_docker_platform() -> str:
    """Pick native Linux arch unless explicitly overridden."""
    override = (os.environ.get("OPENHANDS_DOCKER_PLATFORM") or "").strip()
    if override:
        return override

    machine = platform.machine().lower()
    if machine in {"arm64", "aarch64"}:
        return "linux/arm64"
    return "linux/amd64"


def open_workspace(repo_dir: Path):
    """Return DockerWorkspace only; fail fast if Docker runtime is unavailable."""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True, text=True, timeout=5,
        )
        docker_available = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        docker_available = False

    if not docker_available:
        raise RuntimeError(
            "Docker daemon is unavailable. This test requires DockerWorkspace only. "
            "Start Docker and retry."
        )

    try:
        from openhands.workspace import DockerWorkspace
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Missing package: openhands-workspace. Install it to use DockerWorkspace."
        ) from exc

    image = (os.environ.get("OPENHANDS_DOCKER_SERVER_IMAGE") or "").strip() or DEFAULT_SERVER_IMAGE
    print("[workspace] Using DockerWorkspace (local Docker daemon)")
    workspace_kwargs = {
        "server_image": image,
        "workspace_dir": str(repo_dir),
    }
    try:
        params = inspect.signature(DockerWorkspace).parameters
    except (TypeError, ValueError):
        params = {}
    if "platform" in params:
        workspace_kwargs["platform"] = resolve_docker_platform()
    if "volumes" in params:
        workspace_kwargs["volumes"] = [f"{repo_dir}:/workspace/repo:rw"]  # explicit rw to avoid root-owned files in some Docker versions
    print(f"[workspace] DockerWorkspace kwargs: {workspace_kwargs}")
    return DockerWorkspace(
        **workspace_kwargs,
    )


def build_explain_prompt(repo_url: str, branch: str) -> str:
    return textwrap.dedent(f"""
        You are an expert software engineer. The repository at {repo_url}
        (branch: {branch}) has already been cloned into your working directory.

        Your task:
        1. Run `ls -la` to see top-level files.
        2. Read the README (if present) and the main source files.
        3. Summarise the project: what it is, what it does, its architecture,
           key modules / entry-points, and how someone would typically use it.

        Be thorough but concise.  Do NOT create, modify, or commit any files.
    """).strip()


def print_event(event: Any) -> None:
    """Pretty-print a single OpenHands SDK event to stdout."""
    name = type(event).__name__

    if name == "MessageEvent":
        msg = getattr(event, "llm_message", None)
        role = getattr(msg, "role", "?") if msg else "?"
        content = getattr(msg, "content", "") if msg else ""
        if isinstance(content, list):
            content = "\n".join(
                (b.get("text") if isinstance(b, dict) else getattr(b, "text", ""))
                for b in content
                if b
            )
        content = (content or "").strip()
        if content:
            print(f"\n[{role}]\n{content}")

    elif name == "ActionEvent":
        action = getattr(event, "action", None)
        kind = getattr(action, "kind", type(action).__name__ if action else "action")
        msg = getattr(action, "message", "") if action else ""
        line = f"[action:{kind}]"
        if msg:
            line += f" {str(msg).strip()[:200]}"
        print(line)

    elif name == "ObservationEvent":
        obs = getattr(event, "observation", None)
        okind = getattr(obs, "kind", type(obs).__name__ if obs else "obs")
        text = str(obs).strip() if obs is not None else ""
        preview = text[:300] if text else str(okind)
        print(f"[observe:{okind}] {preview}")

    else:
        text = str(event).strip()
        if text and text != name:
            print(f"[{name}] {text[:300]}")


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Test OpenHands agent: explain a public repo")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub repo URL")
    parser.add_argument("--branch", default=DEFAULT_BRANCH, help="Branch to clone")
    parser.add_argument("--model", default=None, help="LLM model name (overrides env)")
    args = parser.parse_args()

    api_key = require_api_key()
    base_url = resolve_base_url()
    model = (args.model or (os.environ.get("LLM_MODEL") or "").strip() or DEFAULT_MODEL)

    print("=" * 60)
    print(f"  Repo   : {args.repo}")
    print(f"  Branch : {args.branch}")
    print(f"  Model  : {model}")
    print(f"  LLM    : {base_url}")
    print("=" * 60)

    # Import OpenHands SDK
    try:
        from openhands.sdk import Agent, Conversation, LLM, Tool
        from openhands.tools.file_editor import FileEditorTool
        from openhands.tools.terminal import TerminalTool
    except ModuleNotFoundError:
        sys.exit(
            "Missing OpenHands SDK.\n"
            "Install: pip install -r requirements.txt"
        )

    work_dir = Path(tempfile.mkdtemp(prefix="oh-explain-"))
    repo_dir = work_dir / "repo"

    try:
        clone_repo(args.repo, args.branch, repo_dir)

        # Relax permissions so Docker runtime user can read files
        subprocess.run(["chmod", "-R", "a+rX", str(repo_dir)], check=False)

        print(f"\n[agent] Building LLM: {model} via {base_url}")
        llm = LLM(model=model, api_key=api_key, base_url=base_url)

        agent = Agent(
            llm=llm,
            tools=[
                Tool(name=TerminalTool.name),
                Tool(name=FileEditorTool.name),
            ],
        )

        workspace = open_workspace(repo_dir)

        # Enter workspace context if it supports it
        workspace_handle = workspace
        enter_fn = getattr(workspace, "__enter__", None)
        if callable(enter_fn):
            active = enter_fn()
            workspace = active if active is not None else workspace

        conversation = Conversation(
            agent=agent,
            workspace=workspace,
            callbacks=[print_event],
            visualizer=None,
        )

        prompt = build_explain_prompt(args.repo, args.branch)
        print(f"\n[prompt]\n{prompt}\n")
        print("-" * 60)

        try:
            conversation.send_message(prompt)
            conversation.run()
        finally:
            try:
                conversation.close()
            except Exception:
                pass
            exit_fn = getattr(workspace_handle, "__exit__", None)
            if callable(exit_fn):
                exit_fn(None, None, None)

        print("\n" + "=" * 60)
        print("  Agent finished.")
        print("=" * 60)
        return 0

    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 1
    except Exception as exc:
        print(f"\n[error] {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        print(f"[cleanup] Removed {work_dir}")


if __name__ == "__main__":
    sys.exit(main())
