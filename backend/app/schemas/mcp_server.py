from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

McpTransport = Literal["http", "sse", "stdio", "manual"]


class McpServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    transport: McpTransport = "http"
    url: str = Field(default="", max_length=2000)
    headers: dict[str, str] = Field(default_factory=dict)
    auth: str = Field(default="", max_length=200)
    command: str = Field(default="", max_length=500)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    manual_config: dict[str, Any] | None = None
    description: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_required_by_transport(self) -> "McpServerCreate":
        if self.transport in {"http", "sse"} and not self.url.strip():
            raise ValueError("url is required for http/sse MCP servers")
        if self.transport == "stdio" and not self.command.strip():
            raise ValueError("command is required for stdio MCP servers")
        if self.transport == "manual" and not self.manual_config:
            raise ValueError("manual_config is required for manual MCP servers")
        return self


class McpServerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    transport: McpTransport | None = None
    url: str | None = Field(default=None, max_length=2000)
    headers: dict[str, str] | None = None
    auth: str | None = Field(default=None, max_length=200)
    command: str | None = Field(default=None, max_length=500)
    args: list[str] | None = None
    env: dict[str, str] | None = None
    manual_config: dict[str, Any] | None = None
    description: str | None = Field(default=None, max_length=2000)


class McpServerResponse(BaseModel):
    id: str
    user_id: str
    name: str
    transport: McpTransport
    url: str
    headers: dict[str, str] = Field(default_factory=dict)
    auth: str
    command: str
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    manual_config: dict[str, Any] | None = None
    description: str
    created_at: datetime
    updated_at: datetime
