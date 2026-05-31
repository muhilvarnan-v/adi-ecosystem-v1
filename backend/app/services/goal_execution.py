"""Run a goal with OpenHands: clone repo, implement changes, open PR, stream logs."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

import httpx

from app.config import get_settings
from app.services.firestore import get_firestore
from app.services.goal_run_manager import goal_run_manager
from app.services.openhands_agent_settings import build_openhands_settings
from app.services.openhands_runner import run_goal_on_repo
from app.services.sandbox_execution import resolve_workflow_sandbox_execution
from app.services.skill_sync import resolve_agent_skills_for_execution
from app.services.workflow_config import (
    merge_workflow_roles,
    resolve_workflow_roles,
    workflow_enabled,
    effective_workflow_steps,
)


def goal_is_resumable(row: dict[str, Any]) -> bool:
    """OpenHands runs are not resumable mid-flight; allow retry after failure."""
    if row.get("pr_url"):
        return False
    if row.get("execution_status") != "failed":
        return False
    return bool(row.get("application_id"))


def _append_log(
    goal_id: str,
    user_id: str,
    line: str,
    buffer: list[str],
    meta: dict[str, Any] | None = None,
) -> None:
    buffer.append(line)
    payload: dict[str, Any] = {"type": "log", "line": line}
    if meta:
        payload.update(meta)
    goal_run_manager.emit(goal_id, payload)


def _persist_logs(goal_id: str, user_id: str, lines: list[str]) -> None:
    if not lines:
        return
    db = get_firestore()
    db.update_goal(goal_id, user_id, {"execution_log": "\n".join(lines)})


def _persist_workflow_graph(goal_id: str, user_id: str, graph: dict | None) -> None:
    if not graph:
        return
    db = get_firestore()
    db.update_goal(goal_id, user_id, {"workflow_graph": graph})


def _fetch_default_branch(repo_url: str, github_token: str | None) -> str:
    if not github_token:
        return "main"
    try:
        owner, repo_name = (
            repo_url.replace("https://github.com/", "")
            .replace(".git", "")
            .split("/", 1)
        )

        async def _fetch() -> str:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo_name}",
                    headers={
                        "Authorization": f"Bearer {github_token}",
                        "Accept": "application/vnd.github+json",
                    },
                )
                resp.raise_for_status()
                return resp.json().get("default_branch") or "main"

        return asyncio.run(_fetch())
    except Exception:
        return "main"


def _build_goal_text(row: dict[str, Any]) -> str:
    title = (row.get("title") or "").strip()
    description = (row.get("description") or "").strip()
    if title and description:
        return f"{title}\n\n{description}"
    return title or description or "Implement the requested goal"


def _format_chat_thread_for_prompt(db, goal_id: str, user_id: str) -> str:
    rows = db.list_goal_chat_messages(goal_id, user_id, limit=100)
    if not rows:
        return ""
    lines: list[str] = []
    for r in rows:
        role = str(r.get("role") or "user").strip().lower()
        content = str(r.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines)


def _complete_goal(
    goal_id: str,
    user_id: str,
    *,
    pr_url: str,
    log_buffer: list[str],
) -> None:
    db = get_firestore()
    _append_log(goal_id, user_id, f"Pull request: {pr_url}", log_buffer)
    db.update_goal(
        goal_id,
        user_id,
        {
            "status": "done",
            "execution_status": "completed",
            "pr_url": pr_url,
            "execution_error": None,
        },
    )
    _persist_logs(goal_id, user_id, log_buffer)
    goal_run_manager.emit(
        goal_id,
        {"type": "complete", "pr_url": pr_url, "status": "done"},
    )


def _fail_goal(
    goal_id: str,
    user_id: str,
    exc: Exception,
    log_buffer: list[str],
) -> None:
    db = get_firestore()
    message = str(exc)
    _append_log(goal_id, user_id, f"[error] {message}", log_buffer)
    db.update_goal(
        goal_id,
        user_id,
        {
            "execution_status": "failed",
            "execution_error": message,
            "status": "backlog",
        },
    )
    _persist_logs(goal_id, user_id, log_buffer)
    goal_run_manager.emit(goal_id, {"type": "error", "message": message})
    goal_run_manager.emit(
        goal_id,
        {"type": "complete", "status": "failed", "error": message},
    )


def _execute_goal_sync(goal_id: str, user_id: str) -> None:
    settings = get_settings()
    db = get_firestore()
    log_buffer: list[str] = []

    try:
        row = db.get_goal(goal_id, user_id)
        if not row:
            return

        application_id = row.get("application_id")
        if not application_id:
            raise RuntimeError("Goal is missing application")

        app = db.get_application(application_id, user_id)
        if not app:
            raise RuntimeError("Application not found")

        repo_url = (app.get("github_repo_url") or "").strip()
        if not repo_url:
            raise RuntimeError(
                "Application has no GitHub repository. Link a repo on the application first."
            )

        integration = db.get_integration(user_id, "github")
        github_token = None
        if integration:
            github_token = integration.get("tokens", {}).get("access_token")
        if not github_token:
            github_token = (settings.github_token or "").strip() or None

        base_branch = _fetch_default_branch(repo_url, github_token)
        goal_text = _build_goal_text(row)
        chat_ctx = _format_chat_thread_for_prompt(db, goal_id, user_id)
        if chat_ctx:
            goal_text = (
                f"{goal_text}\n\n---\n"
                "Prior conversation with the user about this goal (chronological):\n"
                f"{chat_ctx}\n---\n"
                "Use this thread when implementing. If the user asked something you cannot resolve "
                "from the repository alone, state your assumptions clearly in phase feedback or the PR."
            )

        skills: list[dict] = []
        workflow_roles: dict | None = None
        openhands_settings_for_run: dict[str, Any] | None = None
        use_workflow = workflow_enabled(app, row)

        if use_workflow:
            try:
                workflow_roles = resolve_workflow_roles(app, user_id, row)
            except Exception as exc:
                raise RuntimeError(f"Failed to load workflow agents: {exc}") from exc
            if not workflow_roles:
                use_workflow = False
        else:
            merged = merge_workflow_roles(app, row)
            agent_record_id = row.get("agent_record_id") or merged.get("develop")
            if agent_record_id:
                agent_row = db.get_agent(agent_record_id, user_id)
                if agent_row:
                    try:
                        skills = resolve_agent_skills_for_execution(agent_row, user_id)
                    except Exception as exc:
                        raise RuntimeError(f"Failed to load agent skills: {exc}") from exc
                    mcp_servers: list[dict] = []
                    for mcp_id in agent_row.get("mcp_server_ids") or []:
                        mcp = db.get_mcp_server(mcp_id, user_id)
                        if mcp:
                            mcp_servers.append(mcp)
                    openhands_settings_for_run = build_openhands_settings(
                        agent_row,
                        mcp_servers,
                        settings,
                        user_id,
                        include_secrets=True,
                    )

        db.update_goal(
            goal_id,
            user_id,
            {
                "execution_status": "running",
                "status": "in_progress",
                "execution_log": "",
                "execution_error": None,
                "workflow_graph": None,
            },
        )
        goal_run_manager.emit(goal_id, {"type": "status", "status": "running"})
        if use_workflow:
            _append_log(goal_id, user_id, "Queued multi-agent implementation workflow…", log_buffer)
        else:
            _append_log(goal_id, user_id, "Queued OpenHands coding agent…", log_buffer)
        _append_log(
            goal_id,
            user_id,
            f"Repository: {repo_url} (base branch: {base_branch})",
            log_buffer,
        )
        if use_workflow and workflow_roles:
            step_order = effective_workflow_steps(row)
            role_line = ", ".join(
                f"{role}={workflow_roles[role]['display_name']}"
                for role in step_order
                if role in workflow_roles
            )
            _append_log(goal_id, user_id, f"Workflow agents: {role_line}", log_buffer)
        elif skills:
            names = ", ".join(s["skill_id"] for s in skills)
            _append_log(goal_id, user_id, f"Loading OpenHands skills: {names}", log_buffer)

        def on_log(line: str, meta: dict[str, Any] | None = None) -> None:
            _append_log(goal_id, user_id, line, log_buffer, meta)

        def on_workflow(event: dict) -> None:
            goal_run_manager.emit(goal_id, event)
            graph_payload = event.get("graph")
            if graph_payload:
                _persist_workflow_graph(goal_id, user_id, graph_payload)
            elif event.get("event") == "phase_start" and event.get("node_id"):
                row_now = db.get_goal(goal_id, user_id)
                existing = (row_now or {}).get("workflow_graph") or {"nodes": [], "edges": []}
                if not isinstance(existing, dict):
                    existing = {"nodes": [], "edges": []}
                nodes = list(existing.get("nodes") or [])
                node_id = str(event["node_id"])
                if not any(str(n.get("id")) == node_id for n in nodes):
                    nodes.append(
                        {
                            "id": node_id,
                            "phase": event.get("phase", ""),
                            "cycle": int(event.get("cycle") or 0),
                            "status": "running",
                            "agent": event.get("agent"),
                            "role": event.get("role"),
                        }
                    )
                    existing["nodes"] = nodes
                    _persist_workflow_graph(goal_id, user_id, existing)
            elif event.get("event") == "phase_end" and event.get("node_id"):
                row_now = db.get_goal(goal_id, user_id)
                existing = (row_now or {}).get("workflow_graph") or {"nodes": [], "edges": []}
                if not isinstance(existing, dict):
                    existing = {"nodes": [], "edges": []}
                nodes = list(existing.get("nodes") or [])
                node_id = str(event["node_id"])
                updated = False
                for node in nodes:
                    if str(node.get("id")) == node_id:
                        node["status"] = event.get("status") or node.get("status")
                        if event.get("summary"):
                            node["summary"] = event["summary"]
                        updated = True
                        break
                if not updated:
                    nodes.append(
                        {
                            "id": node_id,
                            "phase": event.get("phase", ""),
                            "cycle": int(event.get("cycle") or 0),
                            "status": event.get("status", "pending"),
                            "agent": event.get("agent"),
                            "summary": event.get("summary"),
                        }
                    )
                existing["nodes"] = nodes
                _persist_workflow_graph(goal_id, user_id, existing)

        gmc = row.get("workflow_max_cycles")
        max_cycles_exec = int(gmc) if gmc is not None else int(app.get("workflow_max_cycles") or 3)
        wf_steps = effective_workflow_steps(row) if use_workflow else None

        try:
            openhands_sandbox = resolve_workflow_sandbox_execution(db, user_id, row)
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc
        if openhands_sandbox:
            kind = openhands_sandbox.get("kind", "docker")
            _append_log(
                goal_id,
                user_id,
                f"Using workflow sandbox: {kind}"
                + (
                    f" (host {openhands_sandbox.get('runtime_host', '')})"
                    if kind == "docker"
                    else f" (runtime {openhands_sandbox.get('runtime_api_url', '')})"
                ),
                log_buffer,
            )

        def on_agent_chat(event: dict[str, Any]) -> None:
            raw_role = str(event.get("role") or "assistant").strip().lower()
            if raw_role not in ("assistant", "system"):
                raw_role = "assistant"
            content = str(event.get("content") or "").strip()
            if not content:
                return
            meta = event.get("metadata")
            added = db.append_goal_chat_message(
                goal_id,
                user_id,
                role=raw_role,
                content=content,
                metadata=meta if isinstance(meta, dict) else None,
            )
            if not added:
                return
            goal_run_manager.emit(
                goal_id,
                {
                    "type": "chat",
                    "chat_message": {
                        "id": added["id"],
                        "role": added.get("role", raw_role),
                        "content": added.get("content", content),
                        "metadata": added.get("metadata"),
                        "created_at": added.get("created_at"),
                    },
                },
            )

        result, workflow_graph = run_goal_on_repo(
            settings=settings,
            repo_url=repo_url,
            goal_text=goal_text,
            base_branch=base_branch,
            goal_id=goal_id,
            github_token=github_token,
            skills=skills,
            workflow_roles=workflow_roles,
            workflow_steps=wf_steps,
            max_cycles=max_cycles_exec,
            on_log=on_log,
            on_workflow=on_workflow if use_workflow else None,
            on_chat=on_agent_chat,
            openhands_sandbox=openhands_sandbox,
            openhands_settings=openhands_settings_for_run if not use_workflow else None,
        )
        _persist_workflow_graph(goal_id, user_id, workflow_graph)

        if result.status == "finished" and result.pr_url:
            _complete_goal(goal_id, user_id, pr_url=result.pr_url, log_buffer=log_buffer)
            return

        detail = result.error or result.summary or "OpenHands agent did not create a pull request"
        raise RuntimeError(detail)

    except Exception as exc:
        _fail_goal(goal_id, user_id, exc, log_buffer)
    finally:
        goal_run_manager.finish(goal_id)


def schedule_goal_execution(goal_id: str, user_id: str) -> None:
    goal_run_manager.get_or_register(goal_id)
    thread = threading.Thread(
        target=_execute_goal_sync,
        args=(goal_id, user_id),
        daemon=True,
        name=f"goal-exec-{goal_id}",
    )
    thread.start()


def schedule_goal_resume(goal_id: str, user_id: str) -> None:
    """Re-run the OpenHands agent after a previous failure."""
    schedule_goal_execution(goal_id, user_id)
