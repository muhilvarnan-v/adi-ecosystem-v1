import secrets
import time
from urllib.parse import urlencode

import httpx

from app.config import Settings

ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize"
ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token"
ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"
JIRA_API_BASE = "https://api.atlassian.com/ex/jira"


class JiraOAuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _redirect_uri(self) -> str:
        return f"{self.settings.oauth_redirect_base.rstrip('/')}/api/integrations/jira/callback"

    def build_authorize_url(self, state: str) -> str:
        params = {
            "audience": "api.atlassian.com",
            "client_id": self.settings.jira_client_id,
            "scope": self.settings.jira_scopes,
            "redirect_uri": self._redirect_uri(),
            "state": state,
            "response_type": "code",
            "prompt": "consent",
        }
        return f"{ATLASSIAN_AUTH_URL}?{urlencode(params)}"

    def generate_state(self) -> str:
        return secrets.token_urlsafe(32)

    async def exchange_code(self, code: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ATLASSIAN_TOKEN_URL,
                json={
                    "grant_type": "authorization_code",
                    "client_id": self.settings.jira_client_id,
                    "client_secret": self.settings.jira_client_secret,
                    "code": code,
                    "redirect_uri": self._redirect_uri(),
                },
            )
            response.raise_for_status()
            return response.json()

    async def refresh_access_token(self, refresh_token: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ATLASSIAN_TOKEN_URL,
                json={
                    "grant_type": "refresh_token",
                    "client_id": self.settings.jira_client_id,
                    "client_secret": self.settings.jira_client_secret,
                    "refresh_token": refresh_token,
                },
            )
            response.raise_for_status()
            return response.json()

    async def get_accessible_resources(self, access_token: str) -> list[dict]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                ATLASSIAN_RESOURCES_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json()

    async def get_valid_tokens(self, stored: dict) -> dict:
        """Return tokens, refreshing if we have a refresh_token and access may be stale."""
        tokens = dict(stored)
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in")
        obtained_at = tokens.get("obtained_at")
        if not refresh_token or not expires_in or not obtained_at:
            return tokens

        if time.time() < obtained_at + int(expires_in) - 60:
            return tokens

        token_data = await self.refresh_access_token(refresh_token)
        tokens["access_token"] = token_data["access_token"]
        tokens["expires_in"] = token_data.get("expires_in", expires_in)
        if token_data.get("refresh_token"):
            tokens["refresh_token"] = token_data["refresh_token"]
        tokens["obtained_at"] = time.time()
        return tokens

    async def fetch_issue(
        self,
        tokens: dict,
        issue_key: str,
    ) -> dict:
        cloud_id = await self._resolve_cloud(tokens)
        if not cloud_id:
            raise ValueError("No accessible Jira sites found for this account")

        url = f"{JIRA_API_BASE}/{cloud_id}/rest/api/3/issue/{issue_key}"
        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
                params={"fields": "summary,description"},
            )
            if response.is_error:
                raise ValueError(_jira_error_detail(response))
            return response.json()

    async def _resolve_cloud(self, tokens: dict) -> str | None:
        cloud_id = tokens.get("cloud_id")
        if cloud_id:
            return cloud_id
        resources = await self.get_accessible_resources(tokens["access_token"])
        if not resources:
            return None
        tokens["cloud_id"] = resources[0]["id"]
        if not tokens.get("site_url"):
            tokens["site_url"] = resources[0].get("url")
        return tokens["cloud_id"]

    async def list_spaces(self, tokens: dict, max_results: int = 100) -> list[dict]:
        cloud_id = await self._resolve_cloud(tokens)
        if not cloud_id:
            return []

        url = f"{JIRA_API_BASE}/{cloud_id}/rest/api/3/project/search"
        spaces: list[dict] = []
        start_at = 0
        async with httpx.AsyncClient() as client:
            while True:
                response = await client.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {tokens['access_token']}",
                        "Accept": "application/json",
                    },
                    params={
                        "maxResults": min(50, max_results - len(spaces)),
                        "startAt": start_at,
                        "orderBy": "name",
                    },
                )
                if response.is_error:
                    raise ValueError(_jira_error_detail(response))
                data = response.json()
                spaces.extend(data.get("values", []))
                if data.get("isLast", True) or len(spaces) >= max_results:
                    break
                start_at += data.get("maxResults", 50)
        return spaces[:max_results]

    async def search_issues(
        self,
        tokens: dict,
        *,
        space_key: str | None = None,
        max_results: int = 100,
    ) -> list[dict]:
        cloud_id = await self._resolve_cloud(tokens)
        if not cloud_id:
            return []

        jql = "updated >= -365d ORDER BY updated DESC"
        if space_key:
            jql = f'project = "{space_key}" AND updated >= -365d ORDER BY updated DESC'

        url = f"{JIRA_API_BASE}/{cloud_id}/rest/api/3/search/jql"
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {tokens['access_token']}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json={
                    "jql": jql,
                    "maxResults": max_results,
                    "fields": ["summary", "description", "project"],
                },
            )
            if response.is_error:
                raise ValueError(_jira_error_detail(response))
            data = response.json()
            return data.get("issues", [])

    @staticmethod
    def space_to_preview(project: dict) -> dict:
        return {
            "id": str(project.get("id", "")),
            "key": project.get("key", ""),
            "name": project.get("name", ""),
        }

    @staticmethod
    def issue_to_preview(issue: dict, site_url: str | None = None) -> dict:
        fields = issue.get("fields", {})
        key = issue.get("key", "")
        description = fields.get("description")
        if isinstance(description, dict):
            description = _adf_to_plain(description)
        elif description is None:
            description = ""
        project = fields.get("project") or {}
        url = f"{site_url}/browse/{key}" if site_url and key else None
        return {
            "id": issue.get("id", ""),
            "key": key,
            "title": fields.get("summary", ""),
            "description": str(description),
            "url": url,
            "space_key": project.get("key"),
            "space_name": project.get("name"),
        }

    @staticmethod
    def issue_to_goal_fields(issue: dict, site_url: str | None = None) -> dict:
        preview = JiraOAuthService.issue_to_preview(issue, site_url)
        return {
            "title": preview["title"],
            "description": preview["description"],
            "external_id": preview["key"],
            "external_url": preview["url"],
        }


def _jira_error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        messages = body.get("errorMessages")
        if messages:
            return "; ".join(messages)
        errors = body.get("errors")
        if errors:
            return "; ".join(f"{k}: {v}" for k, v in errors.items())
    except Exception:
        pass
    text = response.text.strip()
    return text or f"HTTP {response.status_code}"


def _adf_to_plain(node: dict) -> str:
    """Minimal Atlassian Document Format → plain text."""
    if node.get("type") == "text":
        return node.get("text", "")
    parts = []
    for child in node.get("content", []):
        parts.append(_adf_to_plain(child))
    if node.get("type") in ("paragraph", "heading"):
        parts.append("\n")
    return "".join(parts).strip()
