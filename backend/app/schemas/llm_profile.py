from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, HttpUrl


class LlmVendorType(str, Enum):
    LITELLM = "litellm"


class LlmProfileCreate(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    vendor_type: LlmVendorType = LlmVendorType.LITELLM
    base_url: HttpUrl
    model: str = Field(..., min_length=1, max_length=200)
    api_key: str = Field(..., min_length=1, max_length=500)


class LlmProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    base_url: HttpUrl | None = None
    model: str | None = Field(default=None, min_length=1, max_length=200)
    api_key: str | None = Field(default=None, min_length=1, max_length=500)


class LlmProfileResponse(BaseModel):
    id: str
    user_id: str
    display_name: str
    description: str
    vendor_type: LlmVendorType
    base_url: str
    model: str
    api_key_set: bool
    created_at: datetime
    updated_at: datetime


class LlmVendorOption(BaseModel):
    id: str
    label: str
    description: str
