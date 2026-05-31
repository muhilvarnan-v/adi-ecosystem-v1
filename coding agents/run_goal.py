#!/usr/bin/env python3
"""Run one goal on one repo; read JSON from stdin, emit NDJSON logs on stdout."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from run_multi_repo import (  # noqa: E402
    feature_branch_for_repo,
    normalize_repo_url,
    require_api_key,
    resolve_llm_base_url,
    resolve_llm_model,
    run_for_repo,
    run_workflow_for_repo,
)


def emit(payload: dict) -> None:
    print(json.dumps(payload, default=str), flush=True)


def main() -> None:
    payload = json.load(sys.stdin)
    repo_url = str(payload["repo_url"]).strip()
    goal_text = str(payload["goal_text"]).strip()
    base_branch = str(payload.get("base_branch") or "main").strip()
    goal_id = str(payload.get("goal_id") or "").strip() or None
    github_token = payload.get("github_token") or None
    openhands_sandbox = payload.get("openhands_sandbox")
    if not isinstance(openhands_sandbox, dict) or not openhands_sandbox.get("kind"):
        openhands_sandbox = None
    else:
        os.environ.pop("OPENHANDS_RUNTIME_HOST", None)
        os.environ.pop("OPENHANDS_RUNTIME_API_KEY", None)

    if payload.get("llm_api_key"):
        os.environ["LLM_API_KEY"] = str(payload["llm_api_key"]).strip()
    if payload.get("llm_base_url"):
        os.environ["LLM_BASE_URL"] = str(payload["llm_base_url"]).strip()
    if payload.get("llm_model"):
        os.environ["LLM_MODEL"] = str(payload["llm_model"]).strip()

    # Goal agent OpenHands settings (non-workflow): LLM from Harness profile overrides globals.
    oh_settings = payload.get("openhands_settings")
    if isinstance(oh_settings, dict):
        llm_oh = oh_settings.get("llm")
        if isinstance(llm_oh, dict):
            if (llm_oh.get("api_key") or "").strip():
                os.environ["LLM_API_KEY"] = str(llm_oh["api_key"]).strip()
            if (llm_oh.get("base_url") or "").strip():
                os.environ["LLM_BASE_URL"] = str(llm_oh["base_url"]).strip()
            if (llm_oh.get("model") or "").strip():
                os.environ["LLM_MODEL"] = str(llm_oh["model"]).strip()

    api_key = require_api_key()
    model = resolve_llm_model(None)

    def on_log(line: str) -> None:
        emit({"type": "log", "line": line})

    on_log(f"LiteLLM base URL: {resolve_llm_base_url()}")

    skills = payload.get("skills") or []
    workflow_roles = payload.get("workflow_roles") or {}
    max_cycles = int(payload.get("max_cycles") or 3)
    pipeline_steps = payload.get("workflow_steps")
    if not isinstance(pipeline_steps, list) or len(pipeline_steps) == 0:
        pipeline_steps = None

    workflow_graph = None

    def on_workflow(event: dict) -> None:
        emit(event)

    if workflow_roles:
        repo_norm = normalize_repo_url(repo_url)
        feature_branch = feature_branch_for_repo(repo_norm, goal_id)
        on_log("Running multi-agent implementation workflow…")
        result, workflow_graph = run_workflow_for_repo(
            repo_url=repo_url,
            goal=goal_text,
            api_key=api_key,
            model=model,
            base_branch=base_branch,
            feature_branch=feature_branch,
            roles=workflow_roles,
            max_cycles=max_cycles,
            pipeline_steps=pipeline_steps if isinstance(pipeline_steps, list) else None,
            goal_id=goal_id,
            github_token=github_token,
            on_log=on_log,
            on_workflow=on_workflow,
            on_chat=emit,
            openhands_sandbox=openhands_sandbox,
        )
    else:
        result = run_for_repo(
            repo_url=repo_url,
            goal=goal_text,
            api_key=api_key,
            model=model,
            base_branch=base_branch,
            goal_id=goal_id,
            github_token=github_token,
            skills=skills,
            on_log=on_log,
            openhands_sandbox=openhands_sandbox,
        )

    emit(
        {
            "type": "result",
            "status": result.status,
            "pr_url": result.pr_url,
            "summary": result.summary,
            "error": result.error,
            "workflow_graph": workflow_graph,
        }
    )
    sys.exit(0 if result.status == "finished" and result.pr_url else 1)


if __name__ == "__main__":
    main()
