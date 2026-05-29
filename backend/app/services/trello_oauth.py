import secrets
from urllib.parse import urlencode

import httpx
from requests_oauthlib import OAuth1Session

from app.config import Settings

TRELLO_REQUEST_TOKEN_URL = "https://trello.com/1/OAuthGetRequestToken"
TRELLO_AUTHORIZE_URL = "https://trello.com/1/OAuthAuthorizeToken"
TRELLO_ACCESS_TOKEN_URL = "https://trello.com/1/OAuthGetAccessToken"
TRELLO_API_BASE = "https://api.trello.com/1"


class TrelloOAuthService:
    """Trello uses OAuth 1.0a (not OAuth 2.0). This is the standard user-auth flow."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _callback_url(self) -> str:
        return f"{self.settings.oauth_redirect_base.rstrip('/')}/api/integrations/trello/callback"

    def start_oauth(self) -> tuple[OAuth1Session, str, str]:
        oauth = OAuth1Session(
            client_key=self.settings.trello_api_key,
            client_secret=self.settings.trello_api_secret,
            callback_uri=self._callback_url(),
        )
        request_token = oauth.fetch_request_token(TRELLO_REQUEST_TOKEN_URL)
        token = request_token.get("oauth_token")
        token_secret = request_token.get("oauth_token_secret")
        if not token or not token_secret:
            raise ValueError("Failed to obtain Trello request token")

        params = {
            "oauth_token": token,
            "name": "AID",
            "expiration": "never",
            "scope": "read,write",
        }
        authorize_url = f"{TRELLO_AUTHORIZE_URL}?{urlencode(params)}"
        return oauth, token, token_secret

    def complete_oauth(
        self,
        request_token: str,
        request_token_secret: str,
        verifier: str,
    ) -> dict:
        oauth = OAuth1Session(
            client_key=self.settings.trello_api_key,
            client_secret=self.settings.trello_api_secret,
            resource_owner_key=request_token,
            resource_owner_secret=request_token_secret,
            verifier=verifier,
        )
        access_token = oauth.fetch_access_token(TRELLO_ACCESS_TOKEN_URL)
        return {
            "oauth_token": access_token.get("oauth_token"),
            "oauth_token_secret": access_token.get("oauth_token_secret"),
        }

    @staticmethod
    def generate_state() -> str:
        return secrets.token_urlsafe(32)

    def _auth_params(self, tokens: dict) -> dict:
        return {
            "key": self.settings.trello_api_key,
            "token": tokens["oauth_token"],
        }

    async def get_member(self, tokens: dict) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{TRELLO_API_BASE}/members/me",
                params=self._auth_params(tokens),
            )
            response.raise_for_status()
            return response.json()

    async def fetch_card(self, tokens: dict, card_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{TRELLO_API_BASE}/cards/{card_id}",
                params={**self._auth_params(tokens), "fields": "name,desc,url,shortUrl"},
            )
            response.raise_for_status()
            return response.json()

    async def list_cards(self, tokens: dict, limit: int = 30) -> list[dict]:
        async with httpx.AsyncClient() as client:
            boards_resp = await client.get(
                f"{TRELLO_API_BASE}/members/me/boards",
                params={
                    **self._auth_params(tokens),
                    "fields": "name",
                    "filter": "open",
                },
            )
            boards_resp.raise_for_status()
            boards = boards_resp.json()

            cards: list[dict] = []
            for board in boards[:5]:
                cards_resp = await client.get(
                    f"{TRELLO_API_BASE}/boards/{board['id']}/cards",
                    params={
                        **self._auth_params(tokens),
                        "fields": "name,desc,url,shortUrl,idBoard",
                        "limit": str(limit),
                    },
                )
                cards_resp.raise_for_status()
                for card in cards_resp.json():
                    card["board_name"] = board.get("name")
                    cards.append(card)
                    if len(cards) >= limit:
                        return cards
            return cards

    @staticmethod
    def card_to_preview(card: dict) -> dict:
        return {
            "id": card.get("id", ""),
            "title": card.get("name", ""),
            "description": card.get("desc", "") or "",
            "url": card.get("shortUrl") or card.get("url"),
            "board_name": card.get("board_name"),
        }

    @staticmethod
    def card_to_goal_fields(card: dict) -> dict:
        preview = TrelloOAuthService.card_to_preview(card)
        return {
            "title": preview["title"],
            "description": preview["description"],
            "external_id": preview["id"],
            "external_url": preview["url"],
        }
