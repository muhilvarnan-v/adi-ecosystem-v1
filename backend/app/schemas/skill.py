from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class SkillSource(str, Enum):
    MANUAL = "manual"
    GITHUB = "github"


class SkillFile(BaseModel):
    path: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., max_length=500_000)


class SkillCreate(BaseModel):
    skill_id: str = Field(..., min_length=1, max_length=63, pattern=r"^[a-z][a-z0-9-]*[a-z0-9]$")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)
    skill_md: str = Field(..., min_length=1, max_length=500_000)
    keyword_trigger: str = Field(default="", max_length=500)
    additional_files: list[SkillFile] = Field(default_factory=list)


class SkillFromGitHub(BaseModel):
    skill_id: str = Field(..., min_length=1, max_length=63, pattern=r"^[a-z][a-z0-9-]*[a-z0-9]$")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., max_length=2000)
    repo: str = Field(..., min_length=3, max_length=200, pattern=r"^[\w.-]+/[\w.-]+$")
    branch: str = Field(default="main", min_length=1, max_length=200)
    base_path: str = Field(default="", max_length=500)
    include_patterns: list[str] = Field(
        default_factory=lambda: ["SKILL.md", "scripts/**", "references/**", "assets/**"],
        min_length=1,
    )


class SkillUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    skill_md: str | None = Field(default=None, min_length=1, max_length=500_000)
    keyword_trigger: str | None = Field(default=None, max_length=500)
    additional_files: list[SkillFile] | None = None


class SkillResponse(BaseModel):
    id: str
    user_id: str
    skill_id: str
    display_name: str
    description: str
    source: SkillSource
    state: str | None = None
    gcp_name: str | None = None
    github_repo: str | None = None
    github_branch: str | None = None
    github_base_path: str | None = None
    include_patterns: list[str] | None = None
    keyword_trigger: str | None = None
    has_skill_md: bool = False
    created_at: datetime
    updated_at: datetime


class GitHubRepoPreview(BaseModel):
    id: str
    full_name: str
    description: str
    default_branch: str
    url: str | None = None
    private: bool = False
