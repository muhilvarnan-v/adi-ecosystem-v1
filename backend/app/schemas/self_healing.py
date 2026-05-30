from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.goal import GoalExecutionStatus, GoalStatus


class SelfHealingIncident(BaseModel):
    id: str
    key: str | None = None
    title: str
    description: str
    url: str | None = None
    status: str | None = None
    priority: str | None = None
    goal_id: str | None = None
    goal_status: GoalStatus | None = None
    execution_status: GoalExecutionStatus | None = None
    pr_url: str | None = None


class ZendeskWebhookResult(BaseModel):
    matched_applications: int = 0
    triggered_goals: int = 0
    goals: list[dict[str, Any]] = Field(default_factory=list)
    received_at: datetime
