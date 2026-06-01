from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

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


class GoalSource(str, Enum):
    MANUAL = "manual"
    JIRA = "jira"
    TRELLO = "trello"
    ZENDESK = "zendesk"
    CIRCLECI = "circleci"


class GoalStatus(str, Enum):
    BACKLOG = "backlog"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class GoalExecutionStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class GoalCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str = Field(default="", max_length=10000)
    application_id: str = Field(..., min_length=1)
    workflow_id: str = Field(
        ...,
        min_length=1,
        max_length=80,
        description="Saved user workflow (from Workflows) to attach to this goal",
    )
    agent_record_id: str | None = Field(
        default=None,
        min_length=1,
        description="Legacy single-agent id; develop role preferred when workflow_roles set",
    )
    workflow_roles: dict[str, str] = Field(
        default_factory=dict,
        description="Per-goal agent assignment by role (overrides application defaults)",
    )

    @field_validator("workflow_roles", mode="before")
    @classmethod
    def validate_workflow_roles(cls, v: object) -> dict[str, str]:
        if v is None:
            return {}
        if not isinstance(v, dict):
            return {}
        return _normalize_workflow_roles(v)


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    status: GoalStatus | None = None


class GoalFromJira(BaseModel):
    issue_key: str = Field(..., min_length=1, description="Jira issue key, e.g. PROJ-123")
    application_id: str = Field(..., min_length=1)
    workflow_id: str = Field(..., min_length=1, max_length=80)
    workflow_roles: dict[str, str] = Field(default_factory=dict)

    @field_validator("workflow_roles", mode="before")
    @classmethod
    def validate_workflow_roles(cls, v: object) -> dict[str, str]:
        if v is None or not isinstance(v, dict):
            return {}
        return _normalize_workflow_roles(v)


class GoalFromTrello(BaseModel):
    card_id: str = Field(..., min_length=1, description="Trello card ID")
    application_id: str = Field(..., min_length=1)
    workflow_id: str = Field(..., min_length=1, max_length=80)
    workflow_roles: dict[str, str] = Field(default_factory=dict)

    @field_validator("workflow_roles", mode="before")
    @classmethod
    def validate_workflow_roles(cls, v: object) -> dict[str, str]:
        if v is None or not isinstance(v, dict):
            return {}
        return _normalize_workflow_roles(v)


class GoalFromZendesk(BaseModel):
    ticket_id: str = Field(..., min_length=1, description="Zendesk ticket ID")
    application_id: str = Field(..., min_length=1)
    workflow_id: str = Field(..., min_length=1, max_length=80)
    workflow_roles: dict[str, str] = Field(default_factory=dict)

    @field_validator("workflow_roles", mode="before")
    @classmethod
    def validate_workflow_roles(cls, v: object) -> dict[str, str]:
        if v is None or not isinstance(v, dict):
            return {}
        return _normalize_workflow_roles(v)


class WorkflowGraphNode(BaseModel):
    id: str
    phase: str
    cycle: int = 0
    status: str = "pending"
    agent: str | None = None
    role: str | None = None
    summary: str | None = None
    feedback: str | None = None


class WorkflowGraphEdge(BaseModel):
    from_: str = Field(validation_alias="from", serialization_alias="from")
    to: str
    label: str = ""

    model_config = {"populate_by_name": True}


class WorkflowGraph(BaseModel):
    nodes: list[WorkflowGraphNode] = Field(default_factory=list)
    edges: list[WorkflowGraphEdge] = Field(default_factory=list)


class GoalResponse(BaseModel):
    id: str
    user_id: str
    application_id: str | None = None
    title: str
    description: str
    source: GoalSource
    status: GoalStatus
    external_id: str | None = None
    external_url: str | None = None
    agent_record_id: str | None = None
    workflow_id: str | None = None
    workflow_roles: dict[str, str] = Field(default_factory=dict)
    workflow_steps: list[str] = Field(default_factory=list)
    workflow_max_cycles: int | None = None
    interaction_id: str | None = None
    runtime_environment_id: str | None = None
    execution_status: GoalExecutionStatus | None = None
    execution_error: str | None = None
    pr_url: str | None = None
    workflow_graph: WorkflowGraph | None = None
    resumable: bool = False
    created_at: datetime
    updated_at: datetime
