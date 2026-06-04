from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AID"
    debug: bool = False
    cors_origins: str = "http://localhost:5173"

    firestore_project_id: str = Field(
        default="",
        validation_alias=AliasChoices("FIRESTORE_PROJECT_ID", "GOOGLE_CLOUD_PROJECT"),
    )

    oauth_redirect_base: str = "http://localhost:8000"

    jira_client_id: str = ""
    jira_client_secret: str = ""
    jira_scopes: str = "read:jira-work write:jira-work offline_access"

    trello_api_key: str = ""
    trello_api_secret: str = ""

    github_client_id: str = ""
    github_client_secret: str = ""
    github_scopes: str = "read:user read:org repo"

    zendesk_client_id: str = ""
    zendesk_client_secret: str = ""
    zendesk_scopes: str = "read"

    agent_platform_project_id: str = ""
    agent_platform_location: str = "us-central1"

    # Gemini: API key auth only
    gemini_auth_mode: str = "api_key"
    gemini_api_key: str = ""

    # OpenHands coding agent (optional; subprocess also reads os.environ)
    llm_api_key: str = ""
    llm_base_url: str = "https://gap-dev.thoughtworks.net/v1"
    llm_model: str = "openai/ai-ops-gemini-2.5-flash"
    github_token: str = ""

    # When set, coding agents use OpenHands SDK RemoteWorkspace (Docker / agent server).
    # See https://docs.all-hands.dev/modules/usage/architecture/runtime
    openhands_runtime_host: str = ""
    openhands_runtime_api_key: str = ""
    # Passed to subprocess for runtime-side config (optional; server-dependent).
    openhands_docker_base_image: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
