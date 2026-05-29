from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.dependencies import get_user_id
from app.schemas.environment import (
    EnvironmentConfigResponse,
    EnvironmentCreate,
    EnvironmentResponse,
    EnvironmentUpdate,
    NetworkAllowRule,
    SandboxEnvType,
    SkillAttachment,
)
from app.services.environment_config import EnvironmentConfigBuilder
from app.services.firestore import get_firestore

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _sandbox_fields(row: dict) -> dict:
    raw_type = row.get("sandbox_type") or "docker"
    try:
        sandbox_type = SandboxEnvType(raw_type)
    except ValueError:
        sandbox_type = SandboxEnvType.DOCKER
    return {
        "sandbox_type": sandbox_type,
        "docker_server_image": (row.get("docker_server_image") or "").strip()
        or "ghcr.io/openhands/agent-server:latest-python",
        "docker_host_port": int(row.get("docker_host_port") or 3000),
        "remote_runtime_api_url": (row.get("remote_runtime_api_url") or "").strip(),
        "remote_server_image": (row.get("remote_server_image") or "").strip(),
        "remote_runtime_api_key_set": bool((row.get("remote_runtime_api_key") or "").strip()),
    }


def _to_response(row: dict) -> EnvironmentResponse:
    sb = _sandbox_fields(row)
    return EnvironmentResponse(
        id=row["id"],
        user_id=row["user_id"],
        env_id=row["env_id"],
        display_name=row["display_name"],
        description=row.get("description", ""),
        sandbox_type=sb["sandbox_type"],
        docker_server_image=sb["docker_server_image"],
        docker_host_port=sb["docker_host_port"],
        remote_runtime_api_url=sb["remote_runtime_api_url"],
        remote_server_image=sb["remote_server_image"],
        remote_runtime_api_key_set=sb["remote_runtime_api_key_set"],
        skill_attachments=[SkillAttachment(**a) for a in row.get("skill_attachments") or []],
        additional_sources=row.get("additional_sources") or [],
        network_mode=row.get("network_mode", "default"),
        network_allowlist=[NetworkAllowRule(**r) for r in row.get("network_allowlist") or []],
        runtime_environment_id=row.get("runtime_environment_id"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _validate_skill_attachments(user_id: str, attachments: list[SkillAttachment]) -> None:
    if not attachments:
        return
    db = get_firestore()
    skills = {s["skill_id"] for s in db.list_skills(user_id)}
    missing = [a.skill_id for a in attachments if a.skill_id not in skills]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown skill IDs: {', '.join(missing)}. Create skills in Harness first.",
        )


@router.get("", response_model=list[EnvironmentResponse])
def list_environments(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return [_to_response(r) for r in db.list_environments(user_id)]


@router.get("/{record_id}", response_model=EnvironmentResponse)
def get_environment(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_environment(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Sandbox environment not found")
    return _to_response(row)


@router.get("/{record_id}/config", response_model=EnvironmentConfigResponse)
def get_environment_config(record_id: str, user_id: str = Depends(get_user_id)):
    settings = get_settings()
    if not settings.agent_platform_project_id and not settings.firestore_project_id:
        raise HTTPException(status_code=503, detail="Agent Platform project is not configured")

    db = get_firestore()
    row = db.get_environment(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Sandbox environment not found")

    builder = EnvironmentConfigBuilder(settings)
    return EnvironmentConfigResponse(env_id=row["env_id"], config=builder.build(row))


@router.post("", response_model=EnvironmentResponse, status_code=201)
def create_environment(body: EnvironmentCreate, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if db.get_environment_by_env_id(user_id, body.env_id):
        raise HTTPException(status_code=409, detail="A sandbox environment with this ID already exists")

    _validate_skill_attachments(user_id, body.skill_attachments)

    row = db.create_environment(
        user_id=user_id,
        env_id=body.env_id,
        display_name=body.display_name,
        description=body.description,
        skill_attachments=[a.model_dump() for a in body.skill_attachments],
        additional_sources=[s.model_dump() for s in body.additional_sources],
        network_mode=body.network_mode.value,
        network_allowlist=[r.model_dump() for r in body.network_allowlist],
        sandbox_type=body.sandbox_type.value,
        docker_server_image=body.docker_server_image.strip(),
        docker_host_port=body.docker_host_port,
        remote_runtime_api_url=(body.remote_runtime_api_url or "").strip()
        if body.sandbox_type == SandboxEnvType.REMOTE
        else "",
        remote_runtime_api_key=(body.remote_runtime_api_key or "").strip()
        if body.sandbox_type == SandboxEnvType.REMOTE
        else "",
        remote_server_image=(body.remote_server_image or "").strip()
        if body.sandbox_type == SandboxEnvType.REMOTE
        else "",
    )
    return _to_response(row)


@router.patch("/{record_id}", response_model=EnvironmentResponse)
def update_environment(
    record_id: str,
    body: EnvironmentUpdate,
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    row = db.get_environment(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Sandbox environment not found")

    updates = body.model_dump(exclude_unset=True)
    if body.skill_attachments is not None:
        _validate_skill_attachments(user_id, body.skill_attachments)
        updates["skill_attachments"] = [a.model_dump() for a in body.skill_attachments]
    if body.additional_sources is not None:
        updates["additional_sources"] = [s.model_dump() for s in body.additional_sources]
    if body.network_mode is not None:
        updates["network_mode"] = body.network_mode.value
    if body.network_allowlist is not None:
        updates["network_allowlist"] = [r.model_dump() for r in body.network_allowlist]
    if body.sandbox_type is not None:
        updates["sandbox_type"] = body.sandbox_type.value
    if body.docker_server_image is not None:
        updates["docker_server_image"] = body.docker_server_image.strip()
    if body.docker_host_port is not None:
        updates["docker_host_port"] = body.docker_host_port
    if body.remote_runtime_api_url is not None:
        updates["remote_runtime_api_url"] = body.remote_runtime_api_url.strip()
    if body.remote_server_image is not None:
        updates["remote_server_image"] = body.remote_server_image.strip()
    if body.remote_runtime_api_key is not None:
        key = body.remote_runtime_api_key.strip()
        if key:
            updates["remote_runtime_api_key"] = key
        else:
            updates.pop("remote_runtime_api_key", None)

    updated = db.update_environment(record_id, user_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Sandbox environment not found")
    return _to_response(updated)


@router.delete("/{record_id}", status_code=204)
def delete_environment(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_environment(record_id, user_id):
        raise HTTPException(status_code=404, detail="Sandbox environment not found")
