from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException

from app.config import get_settings
from app.schemas.goal import GoalExecutionStatus, GoalStatus
from app.schemas.self_healing import CircleCIWebhookResult, SelfHealingIncident, ZendeskWebhookResult
from app.services.circleci_goal import (
    application_matches_circleci_repo,
    create_circleci_goal_from_failure_event,
    parse_circleci_failure,
    repo_url_from_circleci_payload,
)
from app.services.zendesk_goal import create_zendesk_goal_from_ticket_fields
from app.services.zendesk_oauth import ZendeskOAuthService

WIDGET_STORE_APP = "widget-store-api"
WIDGET_STORE_REPO = "https://github.com/karthikeyan-tw/widget-store-api"
STANDARD_WORKFLOW_NAME = "standard workflow"


def _ticket_text(ticket: dict[str, Any]) -> str:
    values = [
        ticket.get("subject"),
        ticket.get("title"),
        ticket.get("description"),
        ticket.get("body"),
        ticket.get("comment"),
        ticket.get("priority"),
        ticket.get("status"),
    ]
    tags = ticket.get("tags")
    if isinstance(tags, list):
        values.extend(str(tag) for tag in tags)
    return "\n".join(str(v) for v in values if v is not None).lower()


def _ticket_id(ticket: dict[str, Any]) -> str:
    raw = ticket.get("id") or ticket.get("ticket_id") or ticket.get("ticketId")
    return str(raw or "").strip()


def _repo_markers(repo_url: str) -> set[str]:
    raw = repo_url.strip().lower().removesuffix(".git")
    if not raw:
        return set()
    markers = {raw}
    parsed = urlparse(raw)
    path = parsed.path.strip("/")
    if path:
        markers.add(path)
        markers.add(path.rsplit("/", 1)[-1])
    return {marker for marker in markers if marker}


def _matches_application(app: dict[str, Any], ticket: dict[str, Any]) -> bool:
    text = _ticket_text(ticket)
    title = str(app.get("title") or "").strip().lower()
    repo = str(app.get("github_repo_url") or "").strip().lower().removesuffix(".git")
    if title and title in text:
        return True
    if any(marker in text for marker in _repo_markers(repo)):
        return True
    if title == WIDGET_STORE_APP:
        return WIDGET_STORE_APP in text or WIDGET_STORE_REPO in text
    return False


def _resolve_self_healing_workflow_id(db, user_id: str, app: dict[str, Any]) -> str | None:
    workflow_id = str(app.get("self_healing_workflow_id") or "").strip()
    if workflow_id:
        return workflow_id
    workflows = [
        item
        for item in (db.get_user_workflows_row(user_id).get("workflows") or [])
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    ]
    for workflow in workflows:
        wf_id = str(workflow.get("id") or "").strip()
        wf_name = str(workflow.get("name") or "").strip().lower()
        if wf_name == STANDARD_WORKFLOW_NAME:
            return wf_id
    if len(workflows) == 1:
        return str(workflows[0]["id"]).strip()
    return None


def _is_active_incident(ticket: dict[str, Any]) -> bool:
    status = str(ticket.get("status") or "").strip().lower()
    return status not in {"closed", "solved", "deleted"}


def _incident_from_ticket(
    *,
    ticket: dict[str, Any],
    subdomain: str,
    linked_goal: dict[str, Any] | None = None,
) -> SelfHealingIncident:
    preview = ZendeskOAuthService(get_settings()).ticket_to_preview(ticket, subdomain)
    return SelfHealingIncident(
        id=preview["id"],
        key=preview["key"],
        title=preview["title"],
        description=preview["description"],
        url=preview["url"],
        status=str(ticket.get("status") or preview.get("space_key") or "") or None,
        priority=str(ticket.get("priority") or "") or None,
        goal_id=linked_goal.get("id") if linked_goal else None,
        goal_status=_goal_status(linked_goal),
        execution_status=_goal_execution_status(linked_goal),
        pr_url=linked_goal.get("pr_url") if linked_goal else None,
        kind="support",
    )


def _goal_status(row: dict[str, Any] | None) -> GoalStatus | None:
    if not row:
        return None
    try:
        return GoalStatus(row.get("status"))
    except Exception:
        return None


def _goal_execution_status(row: dict[str, Any] | None) -> GoalExecutionStatus | None:
    if not row:
        return None
    raw = row.get("execution_status")
    if not raw:
        return None
    try:
        return GoalExecutionStatus(raw)
    except Exception:
        return None


async def list_application_incidents(db, user_id: str, application_id: str) -> list[SelfHealingIncident]:
    app = db.get_application(application_id, user_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    integration = db.get_integration(user_id, "zendesk")
    if not integration:
        raise HTTPException(status_code=400, detail="Zendesk is not connected")

    zendesk = ZendeskOAuthService(get_settings())
    tokens = await zendesk.get_valid_tokens(integration["tokens"])
    subdomain = tokens.get("subdomain", "")
    try:
        tickets = await zendesk.list_tickets(tokens)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list Zendesk incidents: {exc}") from exc

    if tokens != integration["tokens"]:
        db.save_integration(user_id, "zendesk", tokens, integration.get("account_label"))

    matched = [
        ticket
        for ticket in tickets
        if _is_active_incident(ticket) and _matches_application(app, ticket)
    ]
    if not matched and str(app.get("title") or "").strip().lower() == WIDGET_STORE_APP:
        matched = [ticket for ticket in tickets if _is_active_incident(ticket)][:10]

    incidents: list[SelfHealingIncident] = []
    for ticket in matched:
        external_id = f"#{_ticket_id(ticket)}" if _ticket_id(ticket) else ""
        linked_goal = (
            db.find_goal_by_external_id(user_id, application_id, "zendesk", external_id)
            if external_id
            else None
        )
        incidents.append(_incident_from_ticket(ticket=ticket, subdomain=subdomain, linked_goal=linked_goal))
    return incidents


def _extract_subdomain(payload: dict[str, Any]) -> str:
    raw = (
        payload.get("subdomain")
        or payload.get("zendesk_subdomain")
        or payload.get("account_subdomain")
        or payload.get("account")
        or ""
    )
    return ZendeskOAuthService.normalize_subdomain(str(raw))


def _extract_ticket(payload: dict[str, Any]) -> dict[str, Any]:
    raw = payload.get("ticket")
    if isinstance(raw, dict):
        ticket = dict(raw)
    else:
        ticket = {}
    for source, target in (
        ("ticket_id", "id"),
        ("id", "id"),
        ("subject", "subject"),
        ("title", "subject"),
        ("description", "description"),
        ("body", "description"),
        ("comment", "description"),
        ("status", "status"),
        ("priority", "priority"),
    ):
        if target not in ticket and payload.get(source) is not None:
            ticket[target] = payload[source]
    if "description" not in ticket and ticket.get("subject"):
        ticket["description"] = str(ticket["subject"])
    return ticket


async def handle_zendesk_webhook(db, payload: dict[str, Any]) -> ZendeskWebhookResult:
    subdomain = _extract_subdomain(payload)
    if not subdomain:
        raise HTTPException(
            status_code=400,
            detail="Zendesk webhook payload must include subdomain or account_subdomain.",
        )
    ticket = _extract_ticket(payload)
    if not _ticket_id(ticket) and not ticket.get("subject"):
        raise HTTPException(status_code=400, detail="Zendesk webhook payload must include a ticket.")

    matched_apps = 0
    triggered_goals = 0
    goals: list[dict[str, Any]] = []

    for integration in db.list_zendesk_integrations_by_subdomain(subdomain):
        user_id = integration.get("user_id")
        if not user_id:
            continue
        tokens = integration.get("tokens") or {}
        if _ticket_id(ticket) and not ticket.get("description"):
            try:
                zendesk = ZendeskOAuthService(get_settings())
                valid_tokens = await zendesk.get_valid_tokens(tokens)
                ticket = await zendesk.fetch_ticket(valid_tokens, _ticket_id(ticket))
                if valid_tokens != tokens:
                    db.save_integration(user_id, "zendesk", valid_tokens, integration.get("account_label"))
            except Exception:
                pass

        # Skip tickets that are no longer active (solved/closed/deleted). This prevents
        # an already-resolved ticket from auto-triggering another goal via the webhook.
        if not _is_active_incident(ticket):
            continue

        for app in db.list_self_healing_applications(user_id):
            if not _matches_application(app, ticket):
                continue
            workflow_id = _resolve_self_healing_workflow_id(db, user_id, app)
            if not workflow_id:
                continue
            matched_apps += 1
            row = create_zendesk_goal_from_ticket_fields(
                db,
                user_id=user_id,
                application_id=app["id"],
                ticket=ticket,
                subdomain=subdomain,
                workflow_id=workflow_id,
                workflow_roles={},
                dedupe=True,
            )
            if row:
                goals.append(
                    {
                        "id": row["id"],
                        "application_id": row.get("application_id"),
                        "external_id": row.get("external_id"),
                        "execution_status": row.get("execution_status"),
                        "pr_url": row.get("pr_url"),
                    }
                )
                if row.get("execution_status") in {"queued", "running"}:
                    triggered_goals += 1

    return ZendeskWebhookResult(
        matched_applications=matched_apps,
        triggered_goals=triggered_goals,
        goals=goals,
        received_at=datetime.now(timezone.utc),
    )


def _incident_from_circleci_goal(goal: dict[str, Any]) -> SelfHealingIncident:
    gid = str(goal.get("id") or "")
    return SelfHealingIncident(
        id=gid,
        key=goal.get("external_id"),
        title=str(goal.get("title") or "CircleCI failure"),
        description=str(goal.get("description") or ""),
        url=goal.get("external_url"),
        status=None,
        priority=None,
        goal_id=gid or None,
        goal_status=_goal_status(goal),
        execution_status=_goal_execution_status(goal),
        pr_url=goal.get("pr_url"),
        kind="ci_cd",
    )


def list_application_ci_incidents(db, user_id: str, application_id: str) -> list[SelfHealingIncident]:
    app = db.get_application(application_id, user_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if not db.get_integration(user_id, "circleci"):
        raise HTTPException(
            status_code=400,
            detail="CircleCI is not connected. Connect it in Integrations, then add the outbound webhook in CircleCI.",
        )
    rows = [
        g
        for g in db.list_goals(user_id, application_id=application_id)
        if str(g.get("source") or "") == "circleci"
    ]
    return [_incident_from_circleci_goal(g) for g in rows]


def handle_circleci_webhook(
    db,
    *,
    webhook_token: str,
    circleci_event_type: str | None,
    payload: dict[str, Any],
) -> CircleCIWebhookResult:
    token = webhook_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing webhook token query parameter.")
    integrations = db.list_circleci_integrations_by_webhook_token(token)
    if not integrations:
        raise HTTPException(status_code=404, detail="Unknown CircleCI webhook token.")

    parsed = parse_circleci_failure(payload, circleci_event_type or "")
    if not parsed:
        return CircleCIWebhookResult(
            matched_applications=0,
            triggered_goals=0,
            goals=[],
            received_at=datetime.now(timezone.utc),
            ignored=True,
            ignore_reason="Not a failed workflow-completed or job-completed event.",
        )

    repo_url = repo_url_from_circleci_payload(payload)
    if not repo_url:
        return CircleCIWebhookResult(
            matched_applications=0,
            triggered_goals=0,
            goals=[],
            received_at=datetime.now(timezone.utc),
            ignored=True,
            ignore_reason="Missing VCS repository URL on the pipeline.",
        )

    external_id, title, description, external_url = parsed
    matched_apps = 0
    triggered_goals = 0
    goals: list[dict[str, Any]] = []

    for integration in integrations:
        user_id = integration.get("user_id")
        if not user_id:
            continue
        for app in db.list_self_healing_applications(str(user_id)):
            if not application_matches_circleci_repo(app, repo_url):
                continue
            workflow_id = _resolve_self_healing_workflow_id(db, str(user_id), app)
            if not workflow_id:
                continue
            matched_apps += 1
            row = create_circleci_goal_from_failure_event(
                db,
                user_id=str(user_id),
                application_id=str(app["id"]),
                workflow_id=workflow_id,
                external_id=external_id,
                title=title,
                description=description,
                external_url=external_url,
                workflow_roles={},
                dedupe=True,
            )
            if row:
                goals.append(
                    {
                        "id": row["id"],
                        "application_id": row.get("application_id"),
                        "external_id": row.get("external_id"),
                        "execution_status": row.get("execution_status"),
                        "pr_url": row.get("pr_url"),
                    }
                )
                if row.get("execution_status") in {"queued", "running"}:
                    triggered_goals += 1

    return CircleCIWebhookResult(
        matched_applications=matched_apps,
        triggered_goals=triggered_goals,
        goals=goals,
        received_at=datetime.now(timezone.utc),
    )
