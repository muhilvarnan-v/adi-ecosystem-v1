from datetime import datetime
from enum import Enum

import re

from pydantic import BaseModel, Field, field_validator

from app.schemas.environment import SkillAttachment
from app.services.openhands_agent_settings import DEFAULT_OPENHANDS_TOOLS

# Legacy Gemini builtin tools — ignored for OpenHands agents; kept for old records.
SUPPORTED_BUILTIN_TOOLS = frozenset({"code_execution", "google_search", "url_context"})


class AgentBuiltinTool(str, Enum):
    CODE_EXECUTION = "code_execution"
    GOOGLE_SEARCH = "google_search"
    URL_CONTEXT = "url_context"


def normalize_builtin_tools(tools: list[str] | None) -> list[str]:
    if not tools:
        return []
    return [t for t in tools if t in SUPPORTED_BUILTIN_TOOLS]


class OpenHandsToolName(str, Enum):
    TERMINAL = "terminal"
    FILE_EDITOR = "file_editor"
    TASK_TRACKER = "task_tracker"


class CriticMode(str, Enum):
    FINISH_AND_MESSAGE = "finish_and_message"
    ALL_ACTIONS = "all_actions"


class SecurityAnalyzerType(str, Enum):
    LLM = "llm"
    NONE = "none"


_AGENT_ID_RE = re.compile(r"^[a-z][a-z0-9-]*[a-z0-9]$")


class AgentCreate(BaseModel):
    agent_id: str | None = Field(
        default=None,
        max_length=63,
        description="Optional stable ID for workflows; if omitted, the server generates one.",
    )
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    system_prompt: str = Field(default="", max_length=50000)
    environment_id: str | None = Field(default=None, max_length=200)
    skill_attachments: list[SkillAttachment] = Field(
        default_factory=list,
        description="Harness skills (by skill_id) materialized into the repo for this agent at run time.",
    )
    mcp_server_ids: list[str] = Field(default_factory=list)
    llm_profile_id: str | None = Field(
        default=None,
        min_length=1,
        description="Harness LLM profile (LiteLLM base URL, model, API key)",
    )
    tools: list[OpenHandsToolName] = Field(
        default_factory=lambda: [OpenHandsToolName(t) for t in DEFAULT_OPENHANDS_TOOLS]
    )
    load_project_skills: bool = Field(default=True)
    condenser_enabled: bool = Field(default=True)
    condenser_max_size: int = Field(default=240, ge=20, le=2000)
    critic_enabled: bool = Field(default=False)
    critic_mode: CriticMode = CriticMode.FINISH_AND_MESSAGE
    enable_iterative_refinement: bool = Field(default=False)
    critic_threshold: float = Field(default=0.6, ge=0.0, le=1.0)
    max_refinement_iterations: int = Field(default=3, ge=1, le=20)
    confirmation_mode: bool = Field(default=False)
    security_analyzer: SecurityAnalyzerType = SecurityAnalyzerType.LLM

    @field_validator("agent_id", mode="before")
    @classmethod
    def _normalize_optional_agent_id(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip().lower()
            return s if s else None
        return None

    @field_validator("agent_id")
    @classmethod
    def _validate_agent_id_format(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if len(v) < 1 or not _AGENT_ID_RE.fullmatch(v):
            raise ValueError(
                "agent_id must start with a letter, end with a letter or digit, "
                "and use only lowercase letters, digits, and hyphens (max 63 chars)."
            )
        return v

    @field_validator("tools", mode="before")
    @classmethod
    def _tools_default(cls, v: object) -> list:
        if not v:
            return [OpenHandsToolName(t) for t in DEFAULT_OPENHANDS_TOOLS]
        return v


class AgentUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    system_prompt: str | None = Field(default=None, max_length=50000)
    environment_id: str | None = Field(default=None, max_length=200)
    skill_attachments: list[SkillAttachment] | None = None
    mcp_server_ids: list[str] | None = None
    llm_profile_id: str | None = Field(default=None, min_length=1)
    tools: list[OpenHandsToolName] | None = None
    load_project_skills: bool | None = None
    condenser_enabled: bool | None = None
    condenser_max_size: int | None = Field(default=None, ge=20, le=2000)
    critic_enabled: bool | None = None
    critic_mode: CriticMode | None = None
    enable_iterative_refinement: bool | None = None
    critic_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    max_refinement_iterations: int | None = Field(default=None, ge=1, le=20)
    confirmation_mode: bool | None = None
    security_analyzer: SecurityAnalyzerType | None = None


class AgentResponse(BaseModel):
    id: str
    user_id: str
    agent_id: str
    display_name: str
    description: str
    agent_kind: str = "openhands"
    system_prompt: str = ""
    environment_id: str | None = None
    skill_attachments: list[SkillAttachment] = Field(default_factory=list)
    mcp_server_ids: list[str] = Field(default_factory=list)
    llm_profile_id: str | None = None
    tools: list[str] = Field(default_factory=list)
    load_project_skills: bool = True
    condenser_enabled: bool = True
    condenser_max_size: int = 240
    critic_enabled: bool = False
    critic_mode: str = "finish_and_message"
    enable_iterative_refinement: bool = False
    critic_threshold: float = 0.6
    max_refinement_iterations: int = 3
    confirmation_mode: bool = False
    security_analyzer: str = "llm"
    created_at: datetime
    updated_at: datetime


class OpenHandsSchemaResponse(BaseModel):
    docs_url: str
    agent_kind: str
    sections: list[dict]
    default_tools: list[str]


class AgentConfigResponse(BaseModel):
    agent_id: str
    agent_kind: str = "openhands"
    config: dict
