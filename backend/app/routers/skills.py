from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.dependencies import get_user_id
from app.schemas.skill import (
    SkillCreate,
    SkillFromGitHub,
    SkillResponse,
    SkillSource,
    SkillUpdate,
)
from app.services.firestore import get_firestore
from app.services.github_oauth import GitHubOAuthService
from app.services.skill_registry import SkillRegistryService
from app.schemas.integration import IntegrationProvider

router = APIRouter(prefix="/skills", tags=["skills"])


def _validate_skill_id(skill_id: str) -> None:
    if skill_id.startswith("gcp-"):
        raise HTTPException(status_code=400, detail="Skill ID cannot start with gcp- (reserved for built-in skills)")


def _registry() -> SkillRegistryService:
    settings = get_settings()
    if not settings.agent_platform_project_id and not settings.firestore_project_id:
        raise HTTPException(status_code=503, detail="Agent Platform project is not configured")
    return SkillRegistryService(settings)


def _to_response(row: dict) -> SkillResponse:
    return SkillResponse(
        id=row["id"],
        user_id=row["user_id"],
        skill_id=row["skill_id"],
        display_name=row["display_name"],
        description=row.get("description", ""),
        source=row.get("source", SkillSource.MANUAL),
        state=row.get("state"),
        gcp_name=row.get("gcp_name"),
        github_repo=row.get("github_repo"),
        github_branch=row.get("github_branch"),
        github_base_path=row.get("github_base_path"),
        include_patterns=row.get("include_patterns"),
        has_skill_md=bool((row.get("skill_md") or "").strip()),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _files_from_manual(body: SkillCreate) -> dict[str, bytes]:
    files: dict[str, bytes] = {"SKILL.md": body.skill_md.encode("utf-8")}
    for item in body.additional_files:
        files[item.path.lstrip("/")] = item.content.encode("utf-8")
    return files


@router.get("", response_model=list[SkillResponse])
async def list_skills(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    rows = db.list_skills(user_id)
    registry = _registry()

    gcp_by_id: dict[str, dict] = {}
    try:
        for skill in await registry.list_skills():
            sid = SkillRegistryService.skill_id_from_name(skill.get("name", ""))
            gcp_by_id[sid] = skill
    except Exception:
        pass

    for row in rows:
        gcp = gcp_by_id.get(row["skill_id"])
        if gcp:
            row["state"] = gcp.get("state")
            row["gcp_name"] = gcp.get("name")

    return [_to_response(r) for r in rows]


@router.get("/{record_id}", response_model=SkillResponse)
def get_skill(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_skill(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Skill not found")
    return _to_response(row)


@router.post("", response_model=SkillResponse, status_code=201)
async def create_skill(body: SkillCreate, user_id: str = Depends(get_user_id)):
    _validate_skill_id(body.skill_id)
    db = get_firestore()
    if db.get_skill_by_skill_id(user_id, body.skill_id):
        raise HTTPException(status_code=409, detail="A skill with this ID already exists")

    registry = _registry()
    files = _files_from_manual(body)

    try:
        result = await registry.create_skill(
            skill_id=body.skill_id,
            display_name=body.display_name,
            description=body.description,
            files=files,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to create skill in Skill Registry: {exc}") from exc

    gcp_name = result.get("name") if isinstance(result, dict) else None
    additional_files = [{"path": f.path, "content": f.content} for f in body.additional_files]
    row = db.create_skill(
        user_id=user_id,
        skill_id=body.skill_id,
        display_name=body.display_name,
        description=body.description,
        source=SkillSource.MANUAL.value,
        gcp_name=gcp_name,
        state=result.get("state") if isinstance(result, dict) else "ACTIVE",
        skill_md=body.skill_md,
        additional_files=additional_files,
    )
    return _to_response(row)


@router.post("/from/github", response_model=SkillResponse, status_code=201)
async def create_skill_from_github(body: SkillFromGitHub, user_id: str = Depends(get_user_id)):
    _validate_skill_id(body.skill_id)
    db = get_firestore()
    integration = db.get_integration(user_id, IntegrationProvider.GITHUB.value)
    if not integration:
        raise HTTPException(status_code=400, detail="GitHub is not connected. Connect it in Integrations.")

    if db.get_skill_by_skill_id(user_id, body.skill_id):
        raise HTTPException(status_code=409, detail="A skill with this ID already exists")

    owner, repo_name = body.repo.split("/", 1)
    settings = get_settings()
    github = GitHubOAuthService(settings)
    tokens = integration["tokens"]

    try:
        files = await github.fetch_matching_files(
            tokens["access_token"],
            owner,
            repo_name,
            body.branch,
            body.base_path,
            body.include_patterns,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch files from GitHub: {exc}") from exc

    if not files:
        raise HTTPException(
            status_code=400,
            detail="No files matched the include patterns. Check repo, branch, base path, and patterns.",
        )

    if "SKILL.md" not in files and not any(p.endswith("SKILL.md") for p in files):
        raise HTTPException(status_code=400, detail="Matched files must include SKILL.md")

    registry = _registry()
    try:
        result = await registry.create_skill(
            skill_id=body.skill_id,
            display_name=body.display_name,
            description=body.description,
            files=files,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to create skill in Skill Registry: {exc}") from exc

    gcp_name = result.get("name") if isinstance(result, dict) else None
    row = db.create_skill(
        user_id=user_id,
        skill_id=body.skill_id,
        display_name=body.display_name,
        description=body.description,
        source=SkillSource.GITHUB.value,
        gcp_name=gcp_name,
        state=result.get("state") if isinstance(result, dict) else "ACTIVE",
        github_repo=body.repo,
        github_branch=body.branch,
        github_base_path=body.base_path,
        include_patterns=body.include_patterns,
    )
    return _to_response(row)


@router.patch("/{record_id}", response_model=SkillResponse)
async def update_skill(record_id: str, body: SkillUpdate, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_skill(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Skill not found")

    updates = body.model_dump(exclude_unset=True)
    files = None
    if body.skill_md is not None or body.additional_files is not None:
        files = {"SKILL.md": (body.skill_md or "").encode("utf-8")}
        if body.additional_files:
            for item in body.additional_files:
                files[item.path.lstrip("/")] = item.content.encode("utf-8")

    registry = _registry()
    try:
        await registry.update_skill(
            skill_id=row["skill_id"],
            display_name=updates.get("display_name"),
            description=updates.get("description"),
            files=files,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to update skill in Skill Registry: {exc}") from exc

    db_updates = {k: v for k, v in updates.items() if k not in ("skill_md", "additional_files")}
    if body.skill_md is not None:
        db_updates["skill_md"] = body.skill_md
    if body.additional_files is not None:
        db_updates["additional_files"] = [
            {"path": f.path, "content": f.content} for f in body.additional_files
        ]
    updated = db.update_skill(record_id, user_id, db_updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Skill not found")
    return _to_response(updated)


@router.delete("/{record_id}", status_code=204)
async def delete_skill(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_skill(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Skill not found")

    registry = _registry()
    try:
        await registry.delete_skill(row["skill_id"])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to delete skill from Skill Registry: {exc}") from exc

    db.delete_skill(record_id, user_id)
