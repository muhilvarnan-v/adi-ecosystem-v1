from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class IntegrationProvider(str, Enum):
    JIRA = "jira"
    TRELLO = "trello"
    GITHUB = "github"
    ZENDESK = "zendesk"
    CIRCLECI = "circleci"
    SLA = "sla"


class IntegrationStatus(BaseModel):
    provider: IntegrationProvider
    connected: bool
    connected_at: datetime | None = None
    account_label: str | None = None


class CircleCIConnectResponse(BaseModel):
    webhook_url: str
    setup_note: str


class SLAConnectResponse(BaseModel):
    webhook_url: str
    setup_note: str


class JiraSpacePreview(BaseModel):
    id: str
    key: str
    name: str


class ExternalIssuePreview(BaseModel):
    id: str
    key: str | None = None
    title: str
    description: str
    url: str | None = None
    space_key: str | None = None
    space_name: str | None = None


class ExternalCardPreview(BaseModel):
    id: str
    title: str
    description: str
    url: str | None = None
    board_name: str | None = None
