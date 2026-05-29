from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_user_id
from app.schemas.mcp_server import McpServerCreate, McpServerResponse, McpServerUpdate
from app.services.firestore import get_firestore

router = APIRouter(prefix="/mcp-servers", tags=["mcp-servers"])


def _to_response(row: dict) -> McpServerResponse:
    return McpServerResponse(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        url=row["url"],
        header_key=row.get("header_key", ""),
        header_value=row.get("header_value", ""),
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
    row = db.create_mcp_server(
        user_id=user_id,
        name=body.name.strip(),
        url=body.url.strip(),
        header_key=body.header_key.strip(),
        header_value=body.header_value.strip(),
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
    for key in ("name", "url", "header_key", "header_value", "description"):
        if key in updates and updates[key] is not None:
            updates[key] = str(updates[key]).strip()

    updated = db.update_mcp_server(record_id, user_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return _to_response(updated)


@router.delete("/{record_id}", status_code=204)
def delete_mcp_server(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_mcp_server(record_id, user_id):
        raise HTTPException(status_code=404, detail="MCP server not found")
