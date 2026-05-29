import re
import secrets
import time
from html import unescape
from urllib.parse import urlencode

import httpx

from app.config import Settings

_SUBDOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


class ZendeskOAuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @staticmethod
    def normalize_subdomain(raw: str) -> str:
        value = raw.strip().lower()
        value = value.removeprefix("https://").removeprefix("http://")
        if value.endswith(".zendesk.com"):
            value = value[: -len(".zendesk.com")]
        return value.strip("/")

    @staticmethod
    def validate_subdomain(subdomain: str) -> str:
        normalized = ZendeskOAuthService.normalize_subdomain(subdomain)
        if not normalized or not _SUBDOMAIN_RE.match(normalized):
            raise ValueError(
                "Invalid Zendesk subdomain. Use only letters, numbers, and hyphens "
                "(e.g. your-company from your-company.zendesk.com)."
            )
        return normalized

    def _redirect_uri(self) -> str:
        return f"{self.settings.oauth_redirect_base.rstrip('/')}/api/integrations/zendesk/callback"

    def _auth_url(self, subdomain: str) -> str:
        return f"https://{subdomain}.zendesk.com/oauth/authorizations/new"

    def _token_url(self, subdomain: str) -> str:
        return f"https://{subdomain}.zendesk.com/oauth/tokens"

    def api_base(self, subdomain: str) -> str:
        return f"https://{subdomain}.zendesk.com/api/v2"

    def build_authorize_url(self, subdomain: str, state: str) -> str:
        subdomain = self.validate_subdomain(subdomain)
        params = {
            "response_type": "code",
            "client_id": self.settings.zendesk_client_id,
            "redirect_uri": self._redirect_uri(),
            "scope": self.settings.zendesk_scopes,
            "state": state,
        }
        return f"{self._auth_url(subdomain)}?{urlencode(params)}"

    def generate_state(self) -> str:
        return secrets.token_urlsafe(32)

    async def exchange_code(self, subdomain: str, code: str) -> dict:
        subdomain = self.validate_subdomain(subdomain)
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self._token_url(subdomain),
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self.settings.zendesk_client_id,
                    "client_secret": self.settings.zendesk_client_secret,
                    "redirect_uri": self._redirect_uri(),
                    "scope": self.settings.zendesk_scopes,
                },
            )
            if response.is_error:
                raise ValueError(_zendesk_error_detail(response))
            data = response.json()
        data["subdomain"] = subdomain
        data["obtained_at"] = time.time()
        return data

    async def refresh_access_token(self, subdomain: str, refresh_token: str) -> dict:
        subdomain = self.validate_subdomain(subdomain)
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self._token_url(subdomain),
                json={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": self.settings.zendesk_client_id,
                    "client_secret": self.settings.zendesk_client_secret,
                },
            )
            if response.is_error:
                raise ValueError(_zendesk_error_detail(response))
            data = response.json()
        data["subdomain"] = subdomain
        data["obtained_at"] = time.time()
        return data

    async def get_valid_tokens(self, stored: dict) -> dict:
        tokens = dict(stored)
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in")
        obtained_at = tokens.get("obtained_at")
        subdomain = tokens.get("subdomain")
        if not refresh_token or not expires_in or not obtained_at or not subdomain:
            return tokens

        if time.time() < float(obtained_at) + int(expires_in) - 60:
            return tokens

        token_data = await self.refresh_access_token(subdomain, refresh_token)
        tokens["access_token"] = token_data["access_token"]
        tokens["expires_in"] = token_data.get("expires_in", expires_in)
        if token_data.get("refresh_token"):
            tokens["refresh_token"] = token_data["refresh_token"]
        tokens["obtained_at"] = token_data["obtained_at"]
        return tokens

    def _auth_headers(self, tokens: dict) -> dict[str, str]:
        return {"Authorization": f"Bearer {tokens['access_token']}"}

    async def get_current_user(self, tokens: dict) -> dict:
        subdomain = self.validate_subdomain(tokens["subdomain"])
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.api_base(subdomain)}/users/me.json",
                headers=self._auth_headers(tokens),
            )
            if response.is_error:
                raise ValueError(_zendesk_error_detail(response))
            return response.json().get("user", {})

    async def list_tickets(self, tokens: dict, *, max_results: int = 100) -> list[dict]:
        subdomain = self.validate_subdomain(tokens["subdomain"])
        url = f"{self.api_base(subdomain)}/tickets.json"
        tickets: list[dict] = []
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                url,
                headers=self._auth_headers(tokens),
                params={
                    "sort_by": "updated_at",
                    "sort_order": "desc",
                    "per_page": min(100, max_results),
                },
            )
            if response.is_error:
                raise ValueError(_zendesk_error_detail(response))
            tickets.extend(response.json().get("tickets", []))
        return tickets[:max_results]

    async def fetch_ticket(self, tokens: dict, ticket_id: str) -> dict:
        subdomain = self.validate_subdomain(tokens["subdomain"])
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.api_base(subdomain)}/tickets/{ticket_id}.json",
                headers=self._auth_headers(tokens),
            )
            if response.is_error:
                raise ValueError(_zendesk_error_detail(response))
            return response.json().get("ticket", {})

    @staticmethod
    def ticket_agent_url(subdomain: str, ticket_id: str | int) -> str:
        return f"https://{subdomain}.zendesk.com/agent/tickets/{ticket_id}"

    @staticmethod
    def ticket_to_preview(ticket: dict, subdomain: str) -> dict:
        ticket_id = ticket.get("id")
        ticket_key = f"#{ticket_id}" if ticket_id is not None else None
        description = _html_to_plain(ticket.get("description") or "")
        status = ticket.get("status")
        return {
            "id": str(ticket_id or ""),
            "key": ticket_key,
            "title": ticket.get("subject") or "",
            "description": description,
            "url": ZendeskOAuthService.ticket_agent_url(subdomain, ticket_id) if ticket_id else None,
            "space_key": status,
            "space_name": status.replace("_", " ").title() if isinstance(status, str) else None,
        }

    def ticket_to_goal_fields(self, ticket: dict, subdomain: str) -> dict:
        preview = self.ticket_to_preview(ticket, subdomain)
        external_id = preview["key"] or preview["id"]
        return {
            "title": preview["title"],
            "description": preview["description"],
            "external_id": external_id,
            "external_url": preview["url"],
        }


def _zendesk_error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            if body.get("error_description"):
                return str(body["error_description"])
            if body.get("error"):
                return str(body["error"])
            if body.get("description"):
                return str(body["description"])
    except Exception:
        pass
    text = response.text.strip()
    return text or f"HTTP {response.status_code}"


def _html_to_plain(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" +", " ", text)
    return text.strip()
