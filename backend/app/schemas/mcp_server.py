from datetime import datetime

from pydantic import BaseModel, Field


class McpServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., min_length=1, max_length=2000)
    header_key: str = Field(default="", max_length=200)
    header_value: str = Field(default="", max_length=2000)
    description: str = Field(default="", max_length=2000)


class McpServerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: str | None = Field(default=None, min_length=1, max_length=2000)
    header_key: str | None = Field(default=None, max_length=200)
    header_value: str | None = Field(default=None, max_length=2000)
    description: str | None = Field(default=None, max_length=2000)


class McpServerResponse(BaseModel):
    id: str
    user_id: str
    name: str
    url: str
    header_key: str
    header_value: str
    description: str
    created_at: datetime
    updated_at: datetime
