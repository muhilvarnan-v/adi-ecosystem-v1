from __future__ import annotations

import json
from typing import Any

from app.schemas.goal import GoalExecutionStatus, GoalSource, GoalStatus
from app.schemas.goal import _normalize_workflow_roles as normalize_workflow_roles
from app.services.goal_execution import schedule_goal_execution
from app.services.zendesk_goal import build_goal_workflow_snapshot, require_application_for_goal


def _normalize_github_repo_url(url: str) -> str:
    raw = str(url or "").strip().lower().removesuffix(".git")
    if not raw:
        return ""
    if raw.startswith("git@github.com:"):
        return "https://github.com/" + raw.split(":", 1)[1].strip()
    return raw


def application_matches_circleci_repo(app: dict[str, Any], repo_url: str) -> bool:
    app_repo = str(app.get("github_repo_url") or "").strip()
    if not app_repo or not repo_url:
        return False
    return _normalize_github_repo_url(app_repo) == _normalize_github_repo_url(repo_url)


def repo_url_from_circleci_payload(payload: dict[str, Any]) -> str:
    """Public alias for webhook routing (matches application.github_repo_url)."""
    return _repo_url_from_payload(payload)


def _repo_url_from_payload(payload: dict[str, Any]) -> str:
    pipeline = payload.get("pipeline") if isinstance(payload.get("pipeline"), dict) else {}
    vcs = pipeline.get("vcs") if isinstance(pipeline.get("vcs"), dict) else {}
    return str(
        vcs.get("target_repository_url")
        or vcs.get("origin_repository_url")
        or "",
    ).strip()


def parse_circleci_failure(
    payload: dict[str, Any],
    event_type: str,
) -> tuple[str, str, str, str | None] | None:
    """
    If payload describes a failed workflow or job, return
    (external_id, title, description, external_url). Otherwise None.
    """
    et = (event_type or str(payload.get("type") or "")).strip().lower()
    if et == "workflow-completed":
        wf = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else {}
        status = str(wf.get("status") or "").strip().lower()
        if status not in {"failed", "error"}:
            return None
        wf_id = str(wf.get("id") or "").strip()
        if not wf_id:
            return None
        external_id = f"circleci:workflow:{wf_id}"
        name = str(wf.get("name") or "workflow").strip()
        title = f"CircleCI workflow failed: {name}"
        url = str(wf.get("url") or "").strip() or None
        desc = _build_description(payload, workflow_name=name, job_name=None)
        return external_id, title, desc, url

    if et == "job-completed":
        job = payload.get("job") if isinstance(payload.get("job"), dict) else {}
        status = str(job.get("status") or "").strip().lower()
        if status not in {"failed", "error"}:
            return None
        job_id = str(job.get("id") or "").strip()
        if not job_id:
            return None
        external_id = f"circleci:job:{job_id}"
        name = str(job.get("name") or "job").strip()
        wf = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else {}
        wf_name = str(wf.get("name") or "").strip()
        title = f"CircleCI job failed: {name}"
        url = str(job.get("url") or wf.get("url") or "").strip() or None
        desc = _build_description(payload, workflow_name=wf_name or None, job_name=name)
        return external_id, title, desc, url

    return None


def _build_description(
    payload: dict[str, Any],
    *,
    workflow_name: str | None,
    job_name: str | None,
) -> str:
    pipeline = payload.get("pipeline") if isinstance(payload.get("pipeline"), dict) else {}
    vcs = pipeline.get("vcs") if isinstance(pipeline.get("vcs"), dict) else {}
    num = pipeline.get("number")
    branch = str(vcs.get("branch") or "").strip()
    commit = vcs.get("commit") if isinstance(vcs.get("commit"), dict) else {}
    subject = str(commit.get("subject") or "").strip()
    repo = _repo_url_from_payload(payload)
    lines = [
        "CircleCI reported a failed pipeline run for this repository.",
        "",
        f"- Repository: {repo or '(unknown)'}",
        f"- Pipeline: #{num}" if num is not None else "- Pipeline: (unknown)",
    ]
    if branch:
        lines.append(f"- Branch: {branch}")
    if workflow_name:
        lines.append(f"- Workflow: {workflow_name}")
    if job_name:
        lines.append(f"- Job: {job_name}")
    if subject:
        lines.append(f"- Commit: {subject}")
    lines.append("")
    lines.append("Raw event (subset):")
    lines.append("```json")
    try:
        slim = {
            "type": payload.get("type"),
            "id": payload.get("id"),
            "happened_at": payload.get("happened_at"),
            "workflow": payload.get("workflow"),
            "job": payload.get("job"),
            "pipeline": {
                "id": pipeline.get("id"),
                "number": pipeline.get("number"),
                "vcs": {
                    "branch": vcs.get("branch"),
                    "revision": vcs.get("revision"),
                    "target_repository_url": vcs.get("target_repository_url"),
                },
            },
        }
        lines.append(json.dumps(slim, indent=2)[:8000])
    except Exception:
        lines.append("(could not serialize payload)")
    lines.append("```")
    return "\n".join(lines)


def create_circleci_goal_from_failure_event(
    db,
    *,
    user_id: str,
    application_id: str,
    workflow_id: str,
    external_id: str,
    title: str,
    description: str,
    external_url: str | None,
    workflow_roles: dict[str, str] | None = None,
    dedupe: bool = True,
) -> dict[str, Any] | None:
    app = require_application_for_goal(db, application_id, user_id)

    if dedupe and external_id:
        existing = db.find_goal_by_external_id(
            user_id=user_id,
            application_id=application_id,
            source=GoalSource.CIRCLECI.value,
            external_id=external_id,
        )
        if existing:
            return existing

    roles = normalize_workflow_roles(workflow_roles)
    merged, steps, max_cycles, wf_id = build_goal_workflow_snapshot(
        db, user_id, app, roles, workflow_id
    )

    row = db.create_goal(
        user_id=user_id,
        title=title,
        description=description,
        source=GoalSource.CIRCLECI.value,
        application_id=application_id,
        external_id=external_id,
        external_url=external_url,
        agent_record_id=merged.get("develop"),
        workflow_roles=merged,
        workflow_id=wf_id,
        workflow_steps=steps,
        workflow_max_cycles=max_cycles,
        status=GoalStatus.IN_PROGRESS.value,
        execution_status=GoalExecutionStatus.QUEUED.value,
    )
    schedule_goal_execution(row["id"], user_id)
    return row
