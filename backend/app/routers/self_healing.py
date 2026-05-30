from typing import Any

from fastapi import APIRouter, Depends

from app.dependencies import get_user_id
from app.schemas.self_healing import SelfHealingIncident, ZendeskWebhookResult
from app.services.firestore import get_firestore
from app.services.self_healing import handle_zendesk_webhook, list_application_incidents

router = APIRouter(tags=["self-healing"])


@router.get(
    "/applications/{application_id}/self-healing/incidents",
    response_model=list[SelfHealingIncident],
)
async def list_incidents(application_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return await list_application_incidents(db, user_id, application_id)


@router.post("/self-healing/zendesk/webhook", response_model=ZendeskWebhookResult)
async def zendesk_webhook(payload: dict[str, Any]):
    db = get_firestore()
    return await handle_zendesk_webhook(db, payload)
