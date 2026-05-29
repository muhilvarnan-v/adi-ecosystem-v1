from fastapi import APIRouter, Depends

from app.dependencies import get_user_id
from app.schemas.application import WorkflowDefinition
from app.schemas.workflows import UserWorkflowsPut, UserWorkflowsResponse
from app.services.firestore import get_firestore

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("", response_model=UserWorkflowsResponse)
def list_workflows(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_user_workflows_row(user_id)
    raw = row.get("workflows") or []
    workflows: list[WorkflowDefinition] = []
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                try:
                    workflows.append(WorkflowDefinition.model_validate(item))
                except Exception:
                    continue
    return UserWorkflowsResponse(
        workflows=workflows,
        updated_at=row.get("updated_at"),
    )


@router.put("", response_model=UserWorkflowsResponse)
def replace_workflows(body: UserWorkflowsPut, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    dumped = [w.model_dump() for w in body.workflows]
    row = db.set_user_workflows(user_id, dumped)
    workflows = [WorkflowDefinition.model_validate(x) for x in row.get("workflows") or []]
    return UserWorkflowsResponse(workflows=workflows, updated_at=row.get("updated_at"))
