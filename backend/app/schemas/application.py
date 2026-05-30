from datetime import datetime

from pydantic import BaseModel, Field, HttpUrl, field_validator

from app.services.workflow_config import normalize_workflow_steps

WORKFLOW_ROLE_KEYS = frozenset({"develop", "review", "test", "deploy"})


def _normalize_workflow_roles(value: dict[str, str] | None) -> dict[str, str]:
    if not value:
        return {}
    out: dict[str, str] = {}
    for key, agent_id in value.items():
        role = str(key).strip().lower()
        if role not in WORKFLOW_ROLE_KEYS:
            continue
        rid = str(agent_id).strip()
        if rid:
            out[role] = rid
    return out


class WorkflowDefinition(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=200)
    steps: list[str] = Field(
        default_factory=lambda: ["develop", "review", "test", "deploy"],
        description="Ordered subsequence: develop … deploy (review/test optional)",
    )
    workflow_roles: dict[str, str] = Field(default_factory=dict)
    workflow_max_cycles: int = Field(default=3, ge=1, le=10)
    sandbox_environment_id: str | None = Field(
        default=None,
        max_length=200,
        description="Harness sandbox env record id (OpenHands Docker or API runtime); optional.",
    )

    @field_validator("sandbox_environment_id", mode="before")
    @classmethod
    def normalize_sandbox_environment_id(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("workflow_roles", mode="before")
    @classmethod
    def validate_wf_roles(cls, v: object) -> dict[str, str]:
        return _normalize_workflow_roles(v if isinstance(v, dict) else {})

    @field_validator("steps", mode="before")
    @classmethod
    def validate_steps(cls, v: object) -> list[str]:
        return normalize_workflow_steps(v)


class ApplicationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(default="", max_length=10000)
    github_repo_url: HttpUrl | None = None
    workflow_roles: dict[str, str] = Field(default_factory=dict)
    workflow_max_cycles: int = Field(default=3, ge=1, le=10)
    self_healing_enabled: bool = False
    self_healing_workflow_id: str | None = Field(default=None, max_length=80)

    @field_validator("workflow_roles", mode="before")
    @classmethod
    def validate_workflow_roles(cls, v: object) -> dict[str, str]:
        if v is None:
            return {}
        if not isinstance(v, dict):
            return {}
        return _normalize_workflow_roles(v)

    @field_validator("self_healing_workflow_id", mode="before")
    @classmethod
    def normalize_self_healing_workflow_id(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class ApplicationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    github_repo_url: HttpUrl | None = None
    workflow_roles: dict[str, str] | None = None
    workflow_max_cycles: int | None = Field(default=None, ge=1, le=10)
    self_healing_enabled: bool | None = None
    self_healing_workflow_id: str | None = Field(default=None, max_length=80)

    @field_validator("workflow_roles", mode="before")
    @classmethod
    def validate_workflow_roles(cls, v: object) -> dict[str, str] | None:
        if v is None:
            return None
        if not isinstance(v, dict):
            return {}
        return _normalize_workflow_roles(v)

    @field_validator("self_healing_workflow_id", mode="before")
    @classmethod
    def normalize_self_healing_workflow_id(cls, v: object) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class ApplicationResponse(BaseModel):
    id: str
    user_id: str
    title: str
    description: str
    github_repo_url: str | None = None
    workflow_roles: dict[str, str] = Field(default_factory=dict)
    workflow_max_cycles: int = 3
    self_healing_enabled: bool = False
    self_healing_workflow_id: str | None = None
    created_at: datetime
    updated_at: datetime
