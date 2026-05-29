from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_user_id
from app.schemas.llm_profile import (
    LlmProfileCreate,
    LlmProfileResponse,
    LlmProfileUpdate,
    LlmVendorOption,
    LlmVendorType,
)
from app.services.firestore import get_firestore

router = APIRouter(prefix="/llm-profiles", tags=["llm-profiles"])

VENDOR_OPTIONS = [
    LlmVendorOption(
        id=LlmVendorType.LITELLM.value,
        label="LiteLLM",
        description="OpenAI-compatible proxy; used by OpenHands via api_base and model id.",
    ),
]


def _to_response(row: dict) -> LlmProfileResponse:
    return LlmProfileResponse(
        id=row["id"],
        user_id=row["user_id"],
        display_name=row["display_name"],
        description=row.get("description", ""),
        vendor_type=LlmVendorType(row.get("vendor_type", LlmVendorType.LITELLM.value)),
        base_url=row["base_url"],
        model=row["model"],
        api_key_set=bool((row.get("api_key") or "").strip()),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/options/vendors", response_model=list[LlmVendorOption])
def list_vendor_options():
    return VENDOR_OPTIONS


@router.get("", response_model=list[LlmProfileResponse])
def list_llm_profiles(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    return [_to_response(r) for r in db.list_llm_profiles(user_id)]


@router.get("/{record_id}", response_model=LlmProfileResponse)
def get_llm_profile(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    row = db.get_llm_profile(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="LLM profile not found")
    return _to_response(row)


@router.post("", response_model=LlmProfileResponse, status_code=201)
def create_llm_profile(body: LlmProfileCreate, user_id: str = Depends(get_user_id)):
    if body.vendor_type != LlmVendorType.LITELLM:
        raise HTTPException(status_code=400, detail="Only LiteLLM vendor is supported currently")

    db = get_firestore()
    row = db.create_llm_profile(
        user_id=user_id,
        display_name=body.display_name.strip(),
        description=body.description.strip(),
        vendor_type=body.vendor_type.value,
        base_url=str(body.base_url).rstrip("/"),
        model=body.model.strip(),
        api_key=body.api_key.strip(),
    )
    return _to_response(row)


@router.patch("/{record_id}", response_model=LlmProfileResponse)
def update_llm_profile(
    record_id: str,
    body: LlmProfileUpdate,
    user_id: str = Depends(get_user_id),
):
    db = get_firestore()
    row = db.get_llm_profile(record_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="LLM profile not found")

    updates = body.model_dump(exclude_unset=True)
    if "display_name" in updates and updates["display_name"] is not None:
        updates["display_name"] = updates["display_name"].strip()
    if "description" in updates and updates["description"] is not None:
        updates["description"] = updates["description"].strip()
    if "base_url" in updates and updates["base_url"] is not None:
        updates["base_url"] = str(updates["base_url"]).rstrip("/")
    if "model" in updates and updates["model"] is not None:
        updates["model"] = updates["model"].strip()
    if "api_key" in updates and updates["api_key"] is not None:
        updates["api_key"] = updates["api_key"].strip()

    updated = db.update_llm_profile(record_id, user_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="LLM profile not found")
    return _to_response(updated)


@router.delete("/{record_id}", status_code=204)
def delete_llm_profile(record_id: str, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_llm_profile(record_id, user_id):
        raise HTTPException(status_code=404, detail="LLM profile not found")
