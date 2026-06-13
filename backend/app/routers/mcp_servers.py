from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_user_id
from app.schemas.mcp_server import McpServerCreate, McpServerResponse, McpServerUpdate
from app.services.firestore import get_firestore

router = APIRouter(prefix="/mcp-servers", tags=["mcp-servers"])


def _normalize_headers(row: dict) -> dict[str, str]:
    raw = row.get("headers")
    if isinstance(raw, dict):
        out: dict[str, str] = {}
        for k, v in raw.items():
            key = str(k).strip()
            value = str(v).strip()
            if key and value:
                out[key] = value
        if out:
            return out
    header_key = str(row.get("header_key") or "").strip()
    header_value = str(row.get("header_value") or "").strip()
    if header_key and header_value:
        return {header_key: header_value}
    return {}


def _normalize_env(row: dict) -> dict[str, str]:
    raw = row.get("env")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in raw.items():
        key = str(k).strip()
        value = str(v).strip()
        if key:
            out[key] = value
    return out


def _normalize_args(row: dict) -> list[str]:
    raw = row.get("args")
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def _normalize_manual_config(row: dict) -> dict | None:
    raw = row.get("manual_config")
    if isinstance(raw, dict):
        return raw
    return None


def _transport_or_default(row: dict) -> str:
    transport = str(row.get("transport") or "").strip().lower()
    if transport in {"http", "sse", "stdio", "manual"}:
        return transport
    return "manual" if isinstance(row.get("manual_config"), dict) else "http"


def _validate_payload(payload: dict) -> None:
    transport = _transport_or_default(payload)
    if transport in {"http", "sse"} and not str(payload.get("url") or "").strip():
        raise HTTPException(status_code=400, detail="url is required for http/sse MCP servers")
    if transport == "stdio" and not str(payload.get("command") or "").strip():
        raise HTTPException(status_code=400, detail="command is required for stdio MCP servers")
    if transport == "manual" and (
        not isinstance(payload.get("manual_config"), dict) or not payload.get("manual_config")
    ):
        raise HTTPException(status_code=400, detail="manual_config is required for manual MCP servers")


def _to_response(row: dict) -> McpServerResponse:
    return McpServerResponse(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        transport=_transport_or_default(row),
        url=str(row.get("url") or ""),
        headers=_normalize_headers(row),
        auth=str(row.get("auth") or "").strip(),
        command=str(row.get("command") or "").strip(),
        args=_normalize_args(row),
        env=_normalize_env(row),
        manual_config=_normalize_manual_config(row),
        description=row.get("description", ""),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[McpServerResponse])
def list_mcp_servers(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return [_to_response(r) for r in db.list_mcp_servers(user_id)]


@router.get("/{record_id}", response_model=McpServerResponse)
def get_mcp_server(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_mcp_server(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return _to_response(row)


@router.post("", response_model=McpServerResponse, status_code=201)
def create_mcp_server(body: McpServerCreate, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    payload = {
        "transport": body.transport,
        "url": body.url.strip(),
        "command": body.command.strip(),
        "manual_config": body.manual_config,
    }
    _validate_payload(payload)
    row = db.create_mcp_server(
        user_id=user_id,
        name=body.name.strip(),
        transport=body.transport,
        url=payload["url"],
        headers={
            str(k).strip(): str(v).strip()
            for k, v in body.headers.items()
            if str(k).strip() and str(v).strip()
        },
        auth=body.auth.strip(),
        command=payload["command"],
        args=[str(x).strip() for x in body.args if str(x).strip()],
        env={str(k).strip(): str(v).strip() for k, v in body.env.items() if str(k).strip()},
        manual_config=body.manual_config,
        description=body.description.strip(),
    )
    return _to_response(row)


@router.patch("/{record_id}", response_model=McpServerResponse)
def update_mcp_server(
    record_id: str,
    body: McpServerUpdate,
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    row = db.get_mcp_server(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="MCP server not found")

    updates = body.model_dump(exclude_unset=True)
    for key in ("name", "url", "auth", "command", "description"):
        if key in updates and updates[key] is not None:
            updates[key] = str(updates[key]).strip()

    if "headers" in updates and isinstance(updates["headers"], dict):
        updates["headers"] = {
            str(k).strip(): str(v).strip()
            for k, v in updates["headers"].items()
            if str(k).strip() and str(v).strip()
        }
    if "env" in updates and isinstance(updates["env"], dict):
        updates["env"] = {
            str(k).strip(): str(v).strip() for k, v in updates["env"].items() if str(k).strip()
        }
    if "args" in updates and isinstance(updates["args"], list):
        updates["args"] = [str(x).strip() for x in updates["args"] if str(x).strip()]

    merged = {
        "transport": updates.get("transport", _transport_or_default(row)),
        "url": updates.get("url", str(row.get("url") or "")),
        "command": updates.get("command", str(row.get("command") or "")),
        "manual_config": updates.get("manual_config", row.get("manual_config")),
    }
    _validate_payload(merged)

    updated = db.update_mcp_server(record_id, user_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return _to_response(updated)


@router.delete("/{record_id}", status_code=204)
def delete_mcp_server(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_mcp_server(record_id, user_id):
        raise HTTPException(status_code=404, detail="MCP server not found")
