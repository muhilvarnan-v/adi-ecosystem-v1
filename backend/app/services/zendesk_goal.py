from typing import Any

from fastapi import HTTPException

from app.config import get_settings
from app.schemas.goal import GoalExecutionStatus, GoalSource, GoalStatus
from app.schemas.goal import _normalize_workflow_roles as normalize_workflow_roles
from app.services.goal_execution import schedule_goal_execution
from app.services.workflow_config import (
    WORKFLOW_ROLES,
    normalize_workflow_steps,
    workflow_enabled,
)
from app.services.zendesk_oauth import ZendeskOAuthService


def _find_workflow_definition(db, user_id: str, workflow_id: str) -> dict | None:
    row = db.get_user_workflows_row(user_id)
    for item in row.get("workflows") or []:
        if isinstance(item, dict) and str(item.get("id", "")).strip() == workflow_id:
            return item
    return None


def _require_agent(db, agent_record_id: str, user_id: str) -> None:
    if not db.get_agent(agent_record_id, user_id):
        raise HTTPException(
            status_code=400,
            detail="Unknown agent. Create one in Agents first.",
        )


def _validate_workflow_roles(
    db,
    user_id: str,
    application_row: dict,
    workflow_roles: dict[str, str],
    workflow_steps: list[str] | None = None,
) -> None:
    steps = normalize_workflow_steps(workflow_steps)
    synthetic = {"workflow_roles": workflow_roles, "workflow_steps": steps}
    for role, record_id in workflow_roles.items():
        if role not in WORKFLOW_ROLES:
            continue
        _require_agent(db, record_id, user_id)

    if workflow_roles and not workflow_enabled(application_row, synthetic):
        if not workflow_enabled(application_row, None):
            raise HTTPException(
                status_code=400,
                detail="Assign at least Development and Deployment agents for this goal.",
            )


def build_goal_workflow_snapshot(
    db,
    user_id: str,
    application_row: dict,
    body_roles: dict[str, str],
    workflow_id: str,
) -> tuple[dict[str, str], list[str], int, str]:
    """Merge application defaults + named user workflow + per-goal overrides."""
    wf_ref = str(workflow_id).strip()
    if not wf_ref:
        raise HTTPException(
            status_code=400,
            detail="workflow_id is required. Create and select a workflow under Workflows.",
        )
    spec = _find_workflow_definition(db, user_id, wf_ref)
    if not spec:
        raise HTTPException(
            status_code=400,
            detail="Unknown workflow_id. Create workflows under Workflows or pick another template.",
        )
    app_roles = normalize_workflow_roles(application_row.get("workflow_roles"))
    max_cycles = int(application_row.get("workflow_max_cycles") or 3)
    template_roles = normalize_workflow_roles(spec.get("workflow_roles"))
    steps = normalize_workflow_steps(spec.get("steps"))
    max_cycles = int(spec.get("workflow_max_cycles") or max_cycles)

    merged = {**app_roles, **template_roles, **body_roles}
    _validate_workflow_roles(db, user_id, application_row, merged, steps)
    return merged, steps, max_cycles, wf_ref


def require_application_for_goal(db, application_id: str, user_id: str) -> dict:
    app = db.get_application(application_id, user_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if not app.get("github_repo_url"):
        raise HTTPException(
            status_code=400,
            detail="Link a GitHub repository to this application before creating a goal.",
        )
    return app


def create_zendesk_goal_from_ticket_fields(
    db,
    *,
    user_id: str,
    application_id: str,
    ticket: dict[str, Any],
    subdomain: str,
    workflow_id: str,
    workflow_roles: dict[str, str] | None = None,
    dedupe: bool = False,
) -> dict[str, Any]:
    app = require_application_for_goal(db, application_id, user_id)
    fields = ZendeskOAuthService(get_settings()).ticket_to_goal_fields(ticket, subdomain)
    external_id = fields["external_id"]

    if dedupe and external_id:
        existing = db.find_goal_by_external_id(
            user_id=user_id,
            application_id=application_id,
            source=GoalSource.ZENDESK.value,
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
        title=fields["title"] or f"Zendesk ticket {ticket.get('id') or external_id or ''}".strip(),
        description=fields["description"],
        source=GoalSource.ZENDESK.value,
        application_id=application_id,
        external_id=external_id,
        external_url=fields["external_url"],
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
