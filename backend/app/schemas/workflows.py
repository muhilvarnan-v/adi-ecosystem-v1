from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.application import WorkflowDefinition


class UserWorkflowsResponse(BaseModel):
    workflows: list[WorkflowDefinition] = Field(default_factory=list)
    updated_at: datetime | None = None


class UserWorkflowsPut(BaseModel):
    workflows: list[WorkflowDefinition] = Field(default_factory=list)
