from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class GoalChatMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=16000)


class GoalChatMessageResponse(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    metadata: dict[str, Any] | None = None
    created_at: datetime
