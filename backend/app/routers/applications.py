from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_user_id
from app.schemas.application import (
    ApplicationCreate,
    ApplicationResponse,
    ApplicationUpdate,
)
from app.services.firestore import get_firestore

router = APIRouter(prefix="/applications", tags=["applications"])


def _to_response(row: dict) -> ApplicationResponse:
    return ApplicationResponse(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        description=row.get("description", ""),
        github_repo_url=row.get("github_repo_url"),
        workflow_roles=row.get("workflow_roles") or {},
        workflow_max_cycles=int(row.get("workflow_max_cycles") or 3),
        self_healing_enabled=bool(row.get("self_healing_enabled")),
        self_healing_workflow_id=row.get("self_healing_workflow_id"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _github_repo_url_str(value) -> str | None:
    if value is None:
        return None
    return str(value)


@router.get("", response_model=list[ApplicationResponse])
def list_applications(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return [_to_response(r) for r in db.list_applications(user_id)]


@router.get("/{application_id}", response_model=ApplicationResponse)
def get_application(application_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_application(application_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return _to_response(row)


@router.post("", response_model=ApplicationResponse, status_code=201)
def create_application(body: ApplicationCreate, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.create_application(
        user_id=user_id,
        title=body.title.strip(),
        description=body.description.strip(),
        github_repo_url=_github_repo_url_str(body.github_repo_url),
        workflow_roles=body.workflow_roles,
        workflow_max_cycles=body.workflow_max_cycles,
        self_healing_enabled=body.self_healing_enabled,
        self_healing_workflow_id=body.self_healing_workflow_id,
    )
    return _to_response(row)


@router.patch("/{application_id}", response_model=ApplicationResponse)
def update_application(
    application_id: str,
    body: ApplicationUpdate,
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    updates = body.model_dump(exclude_unset=True)
    if "title" in updates and updates["title"] is not None:
        updates["title"] = updates["title"].strip()
    if "description" in updates and updates["description"] is not None:
        updates["description"] = updates["description"].strip()
    if "github_repo_url" in updates:
        updates["github_repo_url"] = _github_repo_url_str(updates["github_repo_url"])
    if not updates:
        row = db.get_application(application_id, user_id)
        if not row:
            raise HTTPException(status_code=404, detail="Application not found")
        return _to_response(row)
    row = db.update_application(application_id, user_id, updates)
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return _to_response(row)


@router.delete("/{application_id}", status_code=204)
def delete_application(application_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_application(application_id, user_id):
        raise HTTPException(status_code=404, detail="Application not found")
