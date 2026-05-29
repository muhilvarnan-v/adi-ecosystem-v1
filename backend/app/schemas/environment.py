from datetime import datetime
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


class NetworkMode(str, Enum):
    DEFAULT = "default"
    DISABLED = "disabled"
    ALLOWLIST = "allowlist"


class SandboxEnvType(str, Enum):
    """OpenHands execution surface: local Docker agent-server vs hosted runtime API."""

    DOCKER = "docker"
    REMOTE = "remote"


class SkillAttachment(BaseModel):
    skill_id: str = Field(..., min_length=1, max_length=63)
    target: str = Field(default="/.agent/skills/", min_length=2, max_length=500)


class EnvironmentSourceRepository(BaseModel):
    type: Literal["repository"] = "repository"
    source: str = Field(..., min_length=1, max_length=2000)
    target: str = Field(..., min_length=2, max_length=500)


class EnvironmentSourceGcs(BaseModel):
    type: Literal["gcs"] = "gcs"
    source: str = Field(..., min_length=1, max_length=2000)
    target: str = Field(..., min_length=2, max_length=500)


class EnvironmentSourceInline(BaseModel):
    type: Literal["inline"] = "inline"
    content: str = Field(..., max_length=1_000_000)
    target: str = Field(..., min_length=2, max_length=500)


EnvironmentSource = Annotated[
    EnvironmentSourceRepository | EnvironmentSourceGcs | EnvironmentSourceInline,
    Field(discriminator="type"),
]


class NetworkAllowRule(BaseModel):
    domain: str = Field(..., min_length=1, max_length=253)
    transform: dict[str, str] | None = None


class EnvironmentCreate(BaseModel):
    env_id: str = Field(..., min_length=1, max_length=63, pattern=r"^[a-z][a-z0-9-]*[a-z0-9]$")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    sandbox_type: SandboxEnvType = SandboxEnvType.DOCKER
    docker_server_image: str = Field(
        default="ghcr.io/openhands/agent-server:latest-python",
        min_length=1,
        max_length=2000,
    )
    docker_host_port: int = Field(default=3000, ge=1, le=65535)
    remote_runtime_api_url: str = Field(default="", max_length=2000)
    remote_runtime_api_key: str = Field(default="", max_length=500)
    remote_server_image: str = Field(default="", max_length=2000)
    skill_attachments: list[SkillAttachment] = Field(default_factory=list)
    additional_sources: list[EnvironmentSource] = Field(default_factory=list)
    network_mode: NetworkMode = NetworkMode.DEFAULT
    network_allowlist: list[NetworkAllowRule] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_sandbox_fields(self) -> "EnvironmentCreate":
        if self.sandbox_type == SandboxEnvType.DOCKER:
            if not (self.docker_server_image or "").strip():
                raise ValueError("docker_server_image is required for docker sandbox")
            return self
        url = (self.remote_runtime_api_url or "").strip()
        if not url:
            raise ValueError("remote_runtime_api_url is required for remote sandbox")
        if not (self.remote_runtime_api_key or "").strip():
            raise ValueError("remote_runtime_api_key is required for remote sandbox")
        if not (self.remote_server_image or "").strip():
            raise ValueError("remote_server_image is required for remote sandbox")
        return self


class EnvironmentUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    skill_attachments: list[SkillAttachment] | None = None
    additional_sources: list[EnvironmentSource] | None = None
    network_mode: NetworkMode | None = None
    network_allowlist: list[NetworkAllowRule] | None = None
    runtime_environment_id: str | None = Field(default=None, max_length=200)
    sandbox_type: SandboxEnvType | None = None
    docker_server_image: str | None = Field(default=None, min_length=1, max_length=2000)
    docker_host_port: int | None = Field(default=None, ge=1, le=65535)
    remote_runtime_api_url: str | None = Field(default=None, max_length=2000)
    remote_runtime_api_key: str | None = Field(default=None, max_length=500)
    remote_server_image: str | None = Field(default=None, max_length=2000)


class EnvironmentResponse(BaseModel):
    id: str
    user_id: str
    env_id: str
    display_name: str
    description: str
    sandbox_type: SandboxEnvType
    docker_server_image: str
    docker_host_port: int
    remote_runtime_api_url: str
    remote_server_image: str
    remote_runtime_api_key_set: bool
    skill_attachments: list[SkillAttachment]
    additional_sources: list[dict]
    network_mode: NetworkMode
    network_allowlist: list[NetworkAllowRule]
    runtime_environment_id: str | None = None
    created_at: datetime
    updated_at: datetime


class EnvironmentConfigResponse(BaseModel):
    env_id: str
    config: dict
