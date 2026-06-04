import base64
import fnmatch
import re
import secrets
from urllib.parse import urlencode

import httpx

from app.config import Settings

GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_BASE = "https://api.github.com"
GITHUB_USER_AGENT = "AID-backend"


def _normalize_token(access_token: str) -> str:
    token = (access_token or "").strip()
    if not token:
        raise ValueError("GitHub access token is missing")
    return token


def _auth_headers(access_token: str) -> dict[str, str]:
    token = _normalize_token(access_token)
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": GITHUB_USER_AGENT,
    }


def _github_http_error(exc: httpx.HTTPStatusError) -> ValueError:
    status = exc.response.status_code
    try:
        message = exc.response.json().get("message", "")
    except Exception:
        message = ""
    if status in (401, 403, 404):
        hint = (
            "GitHub authentication failed. Disconnect and reconnect GitHub in Integrations "
            "(ensure the OAuth app has repo and read:org scopes), or set GITHUB_TOKEN in the backend .env."
        )
        detail = f"{message}. {hint}" if message else hint
        return ValueError(detail)
    return ValueError(f"GitHub API error ({status}): {message or exc.response.text[:200]}")


class GitHubOAuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _redirect_uri(self) -> str:
        return f"{self.settings.oauth_redirect_base.rstrip('/')}/api/integrations/github/callback"

    def build_authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.settings.github_client_id,
            "redirect_uri": self._redirect_uri(),
            "scope": self.settings.github_scopes,
            "state": state,
        }
        return f"{GITHUB_AUTH_URL}?{urlencode(params)}"

    def generate_state(self) -> str:
        return secrets.token_urlsafe(32)

    async def exchange_code(self, code: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                GITHUB_TOKEN_URL,
                headers={"Accept": "application/json"},
                json={
                    "client_id": self.settings.github_client_id,
                    "client_secret": self.settings.github_client_secret,
                    "code": code,
                    "redirect_uri": self._redirect_uri(),
                },
            )
            response.raise_for_status()
            return response.json()

    async def get_user(self, access_token: str) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/user",
                headers=_auth_headers(access_token),
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise _github_http_error(exc) from exc
            return response.json()

    async def list_repos(self, access_token: str, max_results: int = 1000) -> list[dict]:
        """List repositories visible to the authenticated user (paginated)."""
        repos: list[dict] = []
        per_page = min(100, max_results)
        page = 1

        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = _auth_headers(access_token)
            while len(repos) < max_results:
                response = await client.get(
                    f"{GITHUB_API_BASE}/user/repos",
                    headers=headers,
                    params={
                        "sort": "updated",
                        "direction": "desc",
                        "per_page": per_page,
                        "page": page,
                        # affiliation and type are mutually exclusive on this endpoint;
                        # sending both causes GitHub to return 422.
                        "affiliation": "owner,collaborator,organization_member",
                    },
                )
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    raise _github_http_error(exc) from exc
                batch = response.json()
                if not isinstance(batch, list) or not batch:
                    break
                repos.extend(batch)
                if len(batch) < per_page:
                    break
                page += 1

        return repos[:max_results]

    async def list_repos_for_user(self, user_id: str, max_results: int = 1000) -> list[dict]:
        """List repos using OAuth token, falling back to GITHUB_TOKEN on auth failure."""
        from app.services.github_tokens import resolve_github_tokens

        tokens = resolve_github_tokens(user_id)
        if not tokens:
            raise ValueError(
                "GitHub is not configured. Connect GitHub in Integrations or set GITHUB_TOKEN."
            )

        last_error: Exception | None = None
        for index, token in enumerate(tokens):
            try:
                return await self.list_repos(token, max_results=max_results)
            except (httpx.HTTPStatusError, ValueError) as exc:
                last_error = exc
                if index < len(tokens) - 1:
                    continue
                raise
        raise last_error or ValueError("GitHub authentication failed")

    async def get_repo_tree(
        self,
        access_token: str,
        owner: str,
        repo: str,
        branch: str,
    ) -> list[str]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = _auth_headers(access_token)
            ref_response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}/git/ref/heads/{branch}",
                headers=headers,
            )
            ref_response.raise_for_status()
            sha = ref_response.json()["object"]["sha"]

            tree_response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}/git/trees/{sha}",
                headers=headers,
                params={"recursive": "1"},
            )
            tree_response.raise_for_status()
            tree = tree_response.json()

        paths: list[str] = []
        for item in tree.get("tree", []):
            if item.get("type") == "blob":
                paths.append(item["path"])
        return paths

    async def fetch_file(
        self,
        access_token: str,
        owner: str,
        repo: str,
        path: str,
        branch: str,
    ) -> bytes:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{path}",
                headers=_auth_headers(access_token),
                params={"ref": branch},
            )
            response.raise_for_status()
            data = response.json()
            if data.get("encoding") == "base64":
                return base64.b64decode(data["content"].replace("\n", ""))
            raise ValueError(f"Unsupported encoding for {path}")

    async def fetch_matching_files(
        self,
        access_token: str,
        owner: str,
        repo: str,
        branch: str,
        base_path: str,
        include_patterns: list[str],
    ) -> dict[str, bytes]:
        all_paths = await self.get_repo_tree(access_token, owner, repo, branch)
        base = base_path.strip("/")
        if base:
            scoped = [p for p in all_paths if p == base or p.startswith(f"{base}/")]
            relative = {p[len(base) + 1:] if p.startswith(f"{base}/") else p: p for p in scoped}
        else:
            relative = {p: p for p in all_paths}

        matched: dict[str, bytes] = {}
        for rel_path, full_path in relative.items():
            if not rel_path:
                continue
            if not _path_matches(rel_path, include_patterns):
                continue
            matched[rel_path] = await self.fetch_file(access_token, owner, repo, full_path, branch)
        return matched

    @staticmethod
    def repo_to_preview(repo: dict) -> dict:
        return {
            "id": str(repo.get("id", "")),
            "full_name": repo.get("full_name", ""),
            "description": repo.get("description") or "",
            "default_branch": repo.get("default_branch") or "main",
            "url": repo.get("html_url"),
            "private": repo.get("private", False),
        }


def _path_matches(path: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        if fnmatch.fnmatch(path, pattern):
            return True
        regex = "^" + re.escape(pattern).replace(r"\*\*", ".*").replace(r"\*", "[^/]*") + "$"
        if re.match(regex, path):
            return True
    return False
