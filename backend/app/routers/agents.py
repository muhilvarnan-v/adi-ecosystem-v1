from fastapi import APIRouter, Depends, HTTPException

from app.config import get_settings
from app.dependencies import get_user_id
from app.schemas.agent import (
    AgentConfigResponse,
    AgentCreate,
    AgentResponse,
    AgentUpdate,
    OpenHandsSchemaResponse,
)
from app.services.firestore import get_firestore
from app.services.openhands_agent_settings import (
    build_openhands_settings,
    export_openhands_schema,
    mask_openhands_settings_for_preview,
    normalize_agent_row,
)

router = APIRouter(prefix="/agents", tags=["agents"])


def _to_response(row: dict) -> AgentResponse:
    normalized = normalize_agent_row(row)
    return AgentResponse(
        id=normalized["id"],
        user_id=normalized["user_id"],
        agent_id=normalized["agent_id"],
        display_name=normalized["display_name"],
        description=normalized.get("description", ""),
        agent_kind=normalized.get("agent_kind", "openhands"),
        system_prompt=normalized.get("system_prompt", ""),
        environment_id=normalized.get("environment_id"),
        mcp_server_ids=normalized.get("mcp_server_ids") or [],
        llm_profile_id=normalized.get("llm_profile_id"),
        tools=normalized.get("tools") or [],
        load_project_skills=bool(normalized.get("load_project_skills", True)),
        condenser_enabled=bool(normalized.get("condenser_enabled", True)),
        condenser_max_size=int(normalized.get("condenser_max_size") or 240),
        critic_enabled=bool(normalized.get("critic_enabled", False)),
        critic_mode=str(normalized.get("critic_mode") or "finish_and_message"),
        enable_iterative_refinement=bool(normalized.get("enable_iterative_refinement", False)),
        critic_threshold=float(normalized.get("critic_threshold") or 0.6),
        max_refinement_iterations=int(normalized.get("max_refinement_iterations") or 3),
        confirmation_mode=bool(normalized.get("confirmation_mode", False)),
        security_analyzer=str(normalized.get("security_analyzer") or "llm"),
        created_at=normalized["created_at"],
        updated_at=normalized["updated_at"],
    )


def _validate_environment(user_id: str, environment_id: str | None) -> None:
    if not environment_id:
        return
    db = get_firestore()
    if not db.get_environment(environment_id, user_id):
        raise HTTPException(
            status_code=400,
            detail="Unknown sandbox environment. Create one under Harness → Sandbox envs first.",
        )


def _validate_llm_profile(user_id: str, llm_profile_id: str | None) -> None:
    if not llm_profile_id:
        return
    db = get_firestore()
    if not db.get_llm_profile(llm_profile_id, user_id):
        raise HTTPException(
            status_code=400,
            detail="Unknown LLM profile. Create one in LLM first.",
        )


def _validate_mcp_servers(user_id: str, mcp_server_ids: list[str]) -> None:
    if not mcp_server_ids:
        return
    db = get_firestore()
    known = {s["id"] for s in db.list_mcp_servers(user_id)}
    missing = [sid for sid in mcp_server_ids if sid not in known]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Unknown MCP server IDs. Configure servers in Harness → MCP Servers first.",
        )


def _load_mcp_servers(user_id: str, mcp_ids: list[str]) -> list[dict]:
    db = get_firestore()
    servers = []
    for mcp_id in mcp_ids:
        mcp = db.get_mcp_server(mcp_id, user_id)
        if mcp:
            servers.append(mcp)
    return servers


@router.get("/openhands/schema", response_model=OpenHandsSchemaResponse)
def get_openhands_schema():
    """OpenHands agent settings sections for the Harness UI."""
    data = export_openhands_schema()
    return OpenHandsSchemaResponse(**data)


@router.get("", response_model=list[AgentResponse])
def list_agents(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return [_to_response(r) for r in db.list_agents(user_id)]


@router.get("/{record_id}", response_model=AgentResponse)
def get_agent(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_agent(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _to_response(row)


@router.get("/{record_id}/config", response_model=AgentConfigResponse)
def get_agent_config(record_id: str, user_id: str = Depends(get_user_id)):
    settings = get_settings()
    db = get_firestore()
    row = db.get_agent(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")

    mcp_servers = _load_mcp_servers(user_id, row.get("mcp_server_ids") or [])
    config = build_openhands_settings(row, mcp_servers, settings, user_id, include_secrets=False)
    return AgentConfigResponse(
        agent_id=row["agent_id"],
        agent_kind="openhands",
        config=mask_openhands_settings_for_preview(config),
    )


@router.post("", response_model=AgentResponse, status_code=201)
def create_agent(body: AgentCreate, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if db.get_agent_by_agent_id(user_id, body.agent_id):
        raise HTTPException(status_code=409, detail="An agent with this ID already exists")

    _validate_environment(user_id, body.environment_id)
    _validate_mcp_servers(user_id, body.mcp_server_ids)
    _validate_llm_profile(user_id, body.llm_profile_id)

    row = db.create_agent(
        user_id=user_id,
        agent_id=body.agent_id,
        display_name=body.display_name,
        description=body.description,
        system_prompt=body.system_prompt,
        environment_id=body.environment_id,
        mcp_server_ids=body.mcp_server_ids,
        llm_profile_id=body.llm_profile_id,
        tools=[t.value for t in body.tools],
        load_project_skills=body.load_project_skills,
        condenser_enabled=body.condenser_enabled,
        condenser_max_size=body.condenser_max_size,
        critic_enabled=body.critic_enabled,
        critic_mode=body.critic_mode.value,
        enable_iterative_refinement=body.enable_iterative_refinement,
        critic_threshold=body.critic_threshold,
        max_refinement_iterations=body.max_refinement_iterations,
        confirmation_mode=body.confirmation_mode,
        security_analyzer=body.security_analyzer.value,
    )
    return _to_response(row)


@router.patch("/{record_id}", response_model=AgentResponse)
def update_agent(
    record_id: str,
    body: AgentUpdate,
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    row = db.get_agent(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")

    if body.environment_id is not None:
        _validate_environment(user_id, body.environment_id)
    if body.mcp_server_ids is not None:
        _validate_mcp_servers(user_id, body.mcp_server_ids)
    if body.llm_profile_id is not None:
        _validate_llm_profile(user_id, body.llm_profile_id)

    updates = body.model_dump(exclude_unset=True, mode="json")
    if body.tools is not None:
        updates["tools"] = [t.value for t in body.tools]
    if body.critic_mode is not None:
        updates["critic_mode"] = body.critic_mode.value
    if body.security_analyzer is not None:
        updates["security_analyzer"] = body.security_analyzer.value

    updated = db.update_agent(record_id, user_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _to_response(updated)


@router.delete("/{record_id}", status_code=204)
def delete_agent(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_agent(record_id, user_id):
        raise HTTPException(status_code=404, detail="Agent not found")
