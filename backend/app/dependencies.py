from fastapi import Header, HTTPException


def get_user_id(x_user_id: str | None = Header(default=None, alias="X-User-Id")) -> str:
    """Temporary user scoping until full auth is added in a later phase."""
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="X-User-Id header is required. Use any stable identifier for now.",
        )
    return x_user_id.strip()
