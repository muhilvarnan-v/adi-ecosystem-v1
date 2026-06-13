from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.dependencies import get_user_id
from app.schemas.goal import (
    GoalCreate,
    GoalExecutionStatus,
    GoalFromJira,
    GoalFromTrello,
    GoalFromWiz,
    GoalFromZendesk,
    GoalResponse,
    GoalSource,
    GoalStatus,
    GoalUpdate,
    WorkflowGraph,
)
from app.schemas.goal_chat import GoalChatMessageCreate, GoalChatMessageResponse
from app.services.firestore import get_firestore
from app.schemas.goal import _normalize_workflow_roles as normalize_workflow_roles
from app.services.goal_execution import (
    goal_is_resumable,
    schedule_goal_execution,
    schedule_goal_resume,
)
from app.services.zendesk_goal import create_zendesk_goal_from_ticket_fields
from app.services.self_healing import create_wiz_goal_from_issue_fields
from app.services.workflow_config import (
    WORKFLOW_ROLES,
    normalize_workflow_steps,
    workflow_enabled,
)
from app.services.goal_run_manager import goal_run_manager
from app.services.jira_oauth import JiraOAuthService
from app.services.trello_oauth import TrelloOAuthService
from app.services.zendesk_oauth import ZendeskOAuthService
from app.config import get_settings

router = APIRouter(prefix="/goals", tags=["goals"])

_VALID_CHAT_ROLES = frozenset({"user", "assistant", "system"})


def _chat_row_to_response(row: dict) -> GoalChatMessageResponse:
    raw_role = str(row.get("role") or "user").strip().lower()
    role = raw_role if raw_role in _VALID_CHAT_ROLES else "user"
    created = row.get("created_at")
    if created is None:
        from datetime import datetime, timezone

        created = datetime.now(timezone.utc)
    return GoalChatMessageResponse(
        id=row["id"],
        role=role,  # type: ignore[arg-type]
        content=str(row.get("content") or ""),
        metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else None,
        created_at=created,
    )


def _find_workflow_definition(db, user_id: str, workflow_id: str) -> dict | None:
    row = db.get_user_workflows_row(user_id)
    for item in row.get("workflows") or []:
        if isinstance(item, dict) and str(item.get("id", "")).strip() == workflow_id:
            return item
    return None


def _build_goal_workflow_snapshot(
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


def _to_response(row: dict) -> GoalResponse:
    raw_status = row.get("status", GoalStatus.BACKLOG.value)
    try:
        status = GoalStatus(raw_status)
    except ValueError:
        status = GoalStatus.BACKLOG

    raw_exec = row.get("execution_status")
    execution_status = None
    if raw_exec:
        try:
            execution_status = GoalExecutionStatus(raw_exec)
        except ValueError:
            execution_status = None

    raw_graph = row.get("workflow_graph")
    workflow_graph = None
    if isinstance(raw_graph, dict) and raw_graph.get("nodes"):
        try:
            workflow_graph = WorkflowGraph.model_validate(raw_graph)
        except Exception:
            workflow_graph = None

    return GoalResponse(
        id=row["id"],
        user_id=row["user_id"],
        application_id=row.get("application_id"),
        title=row["title"],
        description=row.get("description", ""),
        source=row.get("source", GoalSource.MANUAL),
        status=status,
        external_id=row.get("external_id"),
        external_url=row.get("external_url"),
        agent_record_id=row.get("agent_record_id"),
        workflow_id=row.get("workflow_id"),
        workflow_roles=row.get("workflow_roles") or {},
        workflow_steps=normalize_workflow_steps(row.get("workflow_steps")),
        workflow_max_cycles=row.get("workflow_max_cycles"),
        interaction_id=row.get("interaction_id"),
        runtime_environment_id=row.get("runtime_environment_id"),
        execution_status=execution_status,
        execution_error=row.get("execution_error"),
        pr_url=row.get("pr_url"),
        workflow_graph=workflow_graph,
        resumable=goal_is_resumable(row),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _require_application(db, application_id: str, user_id: str) -> None:
    if not db.get_application(application_id, user_id):
        raise HTTPException(status_code=404, detail="Application not found")


@router.get("", response_model=list[GoalResponse])
def list_goals(
    application_id: str | None = Query(default=None),
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    if application_id is not None:
        _require_application(db, application_id, user_id)
    return [_to_response(r) for r in db.list_goals(user_id, application_id=application_id)]


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


@router.post("", response_model=GoalResponse, status_code=201)
def create_goal(body: GoalCreate, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    _require_application(db, body.application_id, user_id)
    if body.agent_record_id:
        _require_agent(db, body.agent_record_id, user_id)

    app = db.get_application(body.application_id, user_id)
    if not (app and app.get("github_repo_url")):
        raise HTTPException(
            status_code=400,
            detail="Link a GitHub repository to this application before creating a goal.",
        )

    roles = normalize_workflow_roles(body.workflow_roles)
    merged, steps, max_cycles, wf_id = _build_goal_workflow_snapshot(
        db, user_id, app, roles, body.workflow_id
    )

    row = db.create_goal(
        user_id=user_id,
        title=body.title,
        description=body.description,
        source=GoalSource.MANUAL.value,
        application_id=body.application_id,
        agent_record_id=body.agent_record_id or merged.get("develop"),
        workflow_roles=merged,
        workflow_id=wf_id,
        workflow_steps=steps,
        workflow_max_cycles=max_cycles,
        status=GoalStatus.IN_PROGRESS.value,
        execution_status=GoalExecutionStatus.QUEUED.value,
    )
    schedule_goal_execution(row["id"], user_id)
    return _to_response(row)


@router.get("/{goal_id}/chat", response_model=list[GoalChatMessageResponse])
def list_goal_chat(goal_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.get_goal(goal_id, user_id):
        raise HTTPException(status_code=404, detail="Goal not found")
    rows = db.list_goal_chat_messages(goal_id, user_id)
    return [_chat_row_to_response(r) for r in rows]


@router.post("/{goal_id}/chat", response_model=GoalChatMessageResponse, status_code=201)
def append_goal_chat_user_message(
    goal_id: str,
    body: GoalChatMessageCreate,
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message content is empty")
    row = db.append_goal_chat_message(goal_id, user_id, role="user", content=content)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    msg = _chat_row_to_response(row)
    goal_run_manager.emit(
        goal_id,
        {
            "type": "chat",
            "chat_message": msg.model_dump(mode="json"),
        },
    )
    return msg


@router.get("/{goal_id}/stream")
def stream_goal_execution(goal_id: str, user_id: str = Depends(get_user_id)):
    import json

    db = get_firestore()
    row = db.get_goal(goal_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")

    exec_status = row.get("execution_status")
    live_run = goal_run_manager.has_active_run(goal_id)

    def event_generator():
        if not live_run and exec_status in (
            GoalExecutionStatus.COMPLETED.value,
            GoalExecutionStatus.FAILED.value,
        ):
            execution_log = (row.get("execution_log") or "").strip()
            if execution_log:
                for line in execution_log.splitlines():
                    yield f"data: {json.dumps({'type': 'log', 'line': line})}\n\n"
            elif row.get("execution_error"):
                yield f"data: {json.dumps({'type': 'error', 'message': row['execution_error']})}\n\n"
            if row.get("pr_url"):
                yield f"data: {json.dumps({'type': 'log', 'line': f'Pull request: {row['pr_url']}'})}\n\n"
            raw_graph = row.get("workflow_graph")
            if isinstance(raw_graph, dict) and raw_graph.get("nodes"):
                yield f"data: {json.dumps({'type': 'workflow', 'event': 'run_end', 'graph': raw_graph})}\n\n"
            yield f"data: {json.dumps({'type': 'complete', 'status': row.get('status'), 'pr_url': row.get('pr_url'), 'error': row.get('execution_error')})}\n\n"
            return
        goal_run_manager.get_or_register(goal_id)
        yield from goal_run_manager.iter_sse(goal_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{goal_id}/resume", response_model=GoalResponse)
def resume_goal(goal_id: str, user_id: str = Depends(get_user_id)):
    """Re-run the OpenHands coding agent after a failed execution."""
    db = get_firestore()
    row = db.get_goal(goal_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    if goal_run_manager.has_active_run(goal_id):
        raise HTTPException(status_code=409, detail="Goal execution is already in progress")
    if not goal_is_resumable(row):
        raise HTTPException(
            status_code=400,
            detail="Goal cannot be retried. Requires a failed run with no pull request yet.",
        )

    updated = db.update_goal(
        goal_id,
        user_id,
        {
            "execution_status": GoalExecutionStatus.RUNNING.value,
            "status": GoalStatus.IN_PROGRESS.value,
            "execution_error": None,
        },
    )
    schedule_goal_resume(goal_id, user_id)
    return _to_response(updated or row)


@router.get("/{goal_id}", response_model=GoalResponse)
def get_goal(goal_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_goal(goal_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    return _to_response(row)


@router.post("/from/jira", response_model=GoalResponse, status_code=201)
async def create_goal_from_jira(body: GoalFromJira, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    _require_application(db, body.application_id, user_id)
    integration = db.get_integration(user_id, GoalSource.JIRA.value)
    if not integration:
        raise HTTPException(status_code=400, detail="Jira is not connected. Connect it in Integrations.")

    settings = get_settings()
    jira = JiraOAuthService(settings)
    tokens = await jira.get_valid_tokens(integration["tokens"])

    try:
        issue = await jira.fetch_issue(tokens, body.issue_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Jira issue: {exc}") from exc

    if tokens != integration["tokens"]:
        db.save_integration(
            user_id,
            GoalSource.JIRA.value,
            tokens,
            integration.get("account_label"),
        )

    fields = jira.issue_to_goal_fields(issue, tokens.get("site_url"))
    _require_application(db, body.application_id, user_id)
    app = db.get_application(body.application_id, user_id)
    if not (app and app.get("github_repo_url")):
        raise HTTPException(
            status_code=400,
            detail="Link a GitHub repository to this application before creating a goal.",
        )
    roles = normalize_workflow_roles(body.workflow_roles)
    merged, steps, max_cycles, wf_id = _build_goal_workflow_snapshot(
        db, user_id, app, roles, body.workflow_id
    )
    row = db.create_goal(
        user_id=user_id,
        title=fields["title"] or body.issue_key,
        description=fields["description"],
        source=GoalSource.JIRA.value,
        application_id=body.application_id,
        external_id=fields["external_id"],
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
    return _to_response(row)


@router.post("/from/trello", response_model=GoalResponse, status_code=201)
async def create_goal_from_trello(body: GoalFromTrello, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    _require_application(db, body.application_id, user_id)
    integration = db.get_integration(user_id, GoalSource.TRELLO.value)
    if not integration:
        raise HTTPException(status_code=400, detail="Trello is not connected. Connect it in Integrations.")

    settings = get_settings()
    trello = TrelloOAuthService(settings)
    tokens = integration["tokens"]

    try:
        card = await trello.fetch_card(tokens, body.card_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Trello card: {exc}") from exc

    fields = trello.card_to_goal_fields(card)
    app = db.get_application(body.application_id, user_id)
    if not (app and app.get("github_repo_url")):
        raise HTTPException(
            status_code=400,
            detail="Link a GitHub repository to this application before creating a goal.",
        )
    roles = normalize_workflow_roles(body.workflow_roles)
    merged, steps, max_cycles, wf_id = _build_goal_workflow_snapshot(
        db, user_id, app, roles, body.workflow_id
    )
    row = db.create_goal(
        user_id=user_id,
        title=fields["title"] or "Trello card",
        description=fields["description"],
        source=GoalSource.TRELLO.value,
        application_id=body.application_id,
        external_id=fields["external_id"],
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
    return _to_response(row)


@router.post("/from/zendesk", response_model=GoalResponse, status_code=201)
async def create_goal_from_zendesk(body: GoalFromZendesk, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    _require_application(db, body.application_id, user_id)
    integration = db.get_integration(user_id, GoalSource.ZENDESK.value)
    if not integration:
        raise HTTPException(status_code=400, detail="Zendesk is not connected. Connect it in Integrations.")

    settings = get_settings()
    zendesk = ZendeskOAuthService(settings)
    tokens = await zendesk.get_valid_tokens(integration["tokens"])
    subdomain = tokens.get("subdomain", "")

    try:
        ticket = await zendesk.fetch_ticket(tokens, body.ticket_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch Zendesk ticket: {exc}") from exc

    if tokens != integration["tokens"]:
        db.save_integration(
            user_id,
            GoalSource.ZENDESK.value,
            tokens,
            integration.get("account_label"),
        )

    row = create_zendesk_goal_from_ticket_fields(
        db,
        user_id=user_id,
        application_id=body.application_id,
        ticket=ticket,
        subdomain=subdomain,
        workflow_id=body.workflow_id,
        workflow_roles=body.workflow_roles,
    )
    return _to_response(row)


@router.post("/from/wiz", response_model=GoalResponse, status_code=201)
def create_goal_from_wiz(body: GoalFromWiz, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    app = db.get_application(body.application_id, user_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    issue = next(
        (
            i
            for i in (app.get("security_issues") or [])
            if isinstance(i, dict) and str(i.get("id")) == body.issue_id
        ),
        None,
    )
    if not issue:
        raise HTTPException(
            status_code=404, detail="Security issue not found for this application."
        )
    row = create_wiz_goal_from_issue_fields(
        db,
        user_id=user_id,
        application_id=body.application_id,
        issue=issue,
        workflow_id=body.workflow_id,
        workflow_roles=body.workflow_roles,
        dedupe=True,
    )
    return _to_response(row)


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(goal_id: str, body: GoalUpdate, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    updates = body.model_dump(exclude_unset=True, mode="json")
    if not updates:
        row = db.get_goal(goal_id, user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Goal not found")
        return _to_response(row)
    row = db.update_goal(goal_id, user_id, updates)
    if not row:
        raise HTTPException(status_code=404, detail="Goal not found")
    return _to_response(row)


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_goal(goal_id, user_id):
        raise HTTPException(status_code=404, detail="Goal not found")
