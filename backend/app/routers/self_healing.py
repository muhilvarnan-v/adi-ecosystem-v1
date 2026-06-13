from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request

from app.dependencies import get_user_id
from app.schemas.self_healing import (
    CircleCIWebhookResult,
    SLAWebhookResult,
    SelfHealingIncident,
    WizIngestResult,
    ZendeskWebhookResult,
)
from app.services.firestore import get_firestore
from app.services.self_healing import (
    handle_circleci_webhook,
    handle_sla_webhook,
    handle_zendesk_webhook,
    list_application_ci_incidents,
    list_application_incidents,
    list_application_security_issues,
    list_application_sla_incidents,
    store_wiz_security_issues,
)

router = APIRouter(tags=["self-healing"])


@router.get(
    "/applications/{application_id}/self-healing/incidents",
    response_model=list[SelfHealingIncident],
)
async def list_incidents(application_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return await list_application_incidents(db, user_id, application_id)


@router.get(
    "/applications/{application_id}/self-healing/ci-failures",
    response_model=list[SelfHealingIncident],
)
def list_ci_failures(application_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return list_application_ci_incidents(db, user_id, application_id)


@router.get(
    "/applications/{application_id}/self-healing/sla-breaches",
    response_model=list[SelfHealingIncident],
)
def list_sla_breaches(application_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return list_application_sla_incidents(db, user_id, application_id)


@router.get(
    "/applications/{application_id}/self-healing/security-issues",
    response_model=list[SelfHealingIncident],
)
def list_security_issues(application_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return list_application_security_issues(db, user_id, application_id)


@router.post(
    "/applications/{application_id}/self-healing/security-issues",
    response_model=WizIngestResult,
)
def ingest_security_issues(
    application_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    return store_wiz_security_issues(db, user_id, application_id, payload)


@router.post("/self-healing/zendesk/webhook", response_model=ZendeskWebhookResult)
async def zendesk_webhook(payload: dict[str, Any]):
    print(payload)
    return ZendeskWebhookResult(received_at=datetime.now(timezone.utc))


@router.post("/self-healing/circleci/webhook", response_model=CircleCIWebhookResult)
async def circleci_webhook(
    request: Request,
    token: str = Query(..., min_length=1),
    payload: dict[str, Any] = Body(default_factory=dict),
):
    db = get_firestore()
    event_type = request.headers.get("circleci-event-type") or request.headers.get("Circleci-Event-Type")
    print({"event": "circleci_webhook", "event_type": event_type, "payload": payload})
    return handle_circleci_webhook(
        db,
        webhook_token=token,
        circleci_event_type=event_type,
        payload=payload,
    )


@router.post("/self-healing/sla/webhook", response_model=SLAWebhookResult)
async def sla_webhook(
    token: str = Query(..., min_length=1),
    payload: dict[str, Any] = Body(default_factory=dict),
):
    db = get_firestore()
    print({"event": "sla_webhook", "payload": payload})
    return handle_sla_webhook(
        db,
        webhook_token=token,
        payload=payload,
    )
