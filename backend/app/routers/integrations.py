import time
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.config import get_settings
from app.dependencies import get_user_id
from app.schemas.integration import (
    ExternalCardPreview,
    ExternalIssuePreview,
    IntegrationProvider,
    IntegrationStatus,
    JiraSpacePreview,
)
from app.schemas.skill import GitHubRepoPreview
from app.services.firestore import get_firestore
from app.services.github_oauth import GitHubOAuthService
from app.services.jira_oauth import JiraOAuthService
from app.services.trello_oauth import TrelloOAuthService
from app.services.zendesk_oauth import ZendeskOAuthService

router = APIRouter(prefix="/integrations", tags=["integrations"])

# In-memory OAuth state (use Redis in production)
_oauth_states: dict[str, dict] = {}


def _frontend_integrations_url(status: str | None = None, provider: str | None = None) -> str:
    settings = get_settings()
    base = settings.cors_origin_list[0] if settings.cors_origin_list else "http://localhost:5173"
    params: dict[str, str] = {}
    if status:
        params["status"] = status
    if provider:
        params["provider"] = provider
    query = f"?{urlencode(params)}" if params else ""
    return f"{base}/harness/integrations{query}"


@router.get("", response_model=list[IntegrationStatus])
def list_integrations(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    stored = {i["provider"]: i for i in db.list_integrations(user_id)}
    result = []
    for provider in IntegrationProvider:
        row = stored.get(provider.value)
        result.append(
            IntegrationStatus(
                provider=provider,
                connected=row is not None,
                connected_at=row.get("connected_at") if row else None,
                account_label=row.get("account_label") if row else None,
            )
        )
    return result


@router.delete("/{provider}", status_code=204)
def disconnect(provider: IntegrationProvider, user_id: str = Depends(get_user_id)):
    db = get_firestore()
    if not db.delete_integration(user_id, provider.value):
        raise HTTPException(status_code=404, detail="Integration not connected")


# --- Jira OAuth 2.0 ---

@router.get("/jira/authorize")
def jira_authorize(user_id: str = Depends(get_user_id)):
    settings = get_settings()
    if not settings.jira_client_id or not settings.jira_client_secret:
        raise HTTPException(status_code=503, detail="Jira OAuth is not configured on the server")

    jira = JiraOAuthService(settings)
    state = jira.generate_state()
    _oauth_states[state] = {"user_id": user_id, "provider": "jira"}
    return {"authorize_url": jira.build_authorize_url(state)}


@router.get("/jira/callback")
async def jira_callback(code: str = Query(...), state: str = Query(...)):
    pending = _oauth_states.pop(state, None)
    if not pending:
        return RedirectResponse(_frontend_integrations_url("error", "jira"))

    settings = get_settings()
    jira = JiraOAuthService(settings)
    user_id = pending["user_id"]

    try:
        token_data = await jira.exchange_code(code)
        resources = await jira.get_accessible_resources(token_data["access_token"])
        cloud_id = resources[0]["id"] if resources else None
        site_url = resources[0].get("url") if resources else None
        account_label = resources[0].get("name") if resources else "Jira"

        tokens = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "obtained_at": time.time(),
            "cloud_id": cloud_id,
            "site_url": site_url,
        }
        db = get_firestore()
        db.save_integration(user_id, IntegrationProvider.JIRA.value, tokens, account_label)
        return RedirectResponse(_frontend_integrations_url("connected", "jira"))
    except Exception:
        return RedirectResponse(_frontend_integrations_url("error", "jira"))


async def _jira_tokens_for_user(user_id: str) -> tuple[JiraOAuthService, dict, dict]:
    db = get_firestore()
    integration = db.get_integration(user_id, IntegrationProvider.JIRA.value)
    if not integration:
        raise HTTPException(status_code=400, detail="Jira is not connected")
    settings = get_settings()
    jira = JiraOAuthService(settings)
    tokens = await jira.get_valid_tokens(integration["tokens"])
    return jira, tokens, integration


def _persist_jira_tokens_if_changed(
    user_id: str,
    tokens: dict,
    integration: dict,
) -> None:
    if tokens != integration["tokens"]:
        db = get_firestore()
        db.save_integration(
            user_id,
            IntegrationProvider.JIRA.value,
            tokens,
            integration.get("account_label"),
        )


@router.get("/jira/spaces", response_model=list[JiraSpacePreview])
async def jira_spaces(user_id: str = Depends(get_user_id)):
    jira, tokens, integration = await _jira_tokens_for_user(user_id)
    try:
        projects = await jira.list_spaces(tokens)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list Jira spaces: {exc}") from exc

    _persist_jira_tokens_if_changed(user_id, tokens, integration)
    return [JiraSpacePreview(**jira.space_to_preview(p)) for p in projects]


@router.get("/jira/issues", response_model=list[ExternalIssuePreview])
async def jira_issues(
    user_id: str = Depends(get_user_id),
    space_key: str | None = Query(default=None, description="Jira project key to filter by"),
):
    jira, tokens, integration = await _jira_tokens_for_user(user_id)
    try:
        issues = await jira.search_issues(tokens, space_key=space_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list Jira issues: {exc}") from exc

    _persist_jira_tokens_if_changed(user_id, tokens, integration)
    site_url = tokens.get("site_url")
    return [ExternalIssuePreview(**jira.issue_to_preview(i, site_url)) for i in issues]


# --- Trello OAuth 1.0a ---

@router.get("/trello/authorize")
def trello_authorize(user_id: str = Depends(get_user_id)):
    settings = get_settings()
    if not settings.trello_api_key or not settings.trello_api_secret:
        raise HTTPException(status_code=503, detail="Trello OAuth is not configured on the server")

    trello = TrelloOAuthService(settings)
    try:
        _, request_token, request_token_secret = trello.start_oauth()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to start Trello OAuth: {exc}") from exc

    state = trello.generate_state()
    _oauth_states[state] = {
        "user_id": user_id,
        "provider": "trello",
        "request_token": request_token,
        "request_token_secret": request_token_secret,
    }
    params = urlencode({"oauth_token": request_token, "name": "AID", "expiration": "never", "scope": "read,write"})
    return {"authorize_url": f"https://trello.com/1/OAuthAuthorizeToken?{params}"}


@router.get("/trello/callback")
async def trello_callback(
    oauth_token: str = Query(...),
    oauth_verifier: str = Query(...),
):
    pending = None
    for key, value in list(_oauth_states.items()):
        if value.get("provider") == "trello" and value.get("request_token") == oauth_token:
            pending = _oauth_states.pop(key)
            break

    if not pending:
        return RedirectResponse(_frontend_integrations_url("error", "trello"))

    settings = get_settings()
    trello = TrelloOAuthService(settings)
    user_id = pending["user_id"]

    try:
        tokens = trello.complete_oauth(
            pending["request_token"],
            pending["request_token_secret"],
            oauth_verifier,
        )
        member = await trello.get_member(tokens)
        account_label = member.get("fullName") or member.get("username") or "Trello"
        db = get_firestore()
        db.save_integration(user_id, IntegrationProvider.TRELLO.value, tokens, account_label)
        return RedirectResponse(_frontend_integrations_url("connected", "trello"))
    except Exception:
        return RedirectResponse(_frontend_integrations_url("error", "trello"))


@router.get("/trello/cards", response_model=list[ExternalCardPreview])
async def trello_cards(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    integration = db.get_integration(user_id, IntegrationProvider.TRELLO.value)
    if not integration:
        raise HTTPException(status_code=400, detail="Trello is not connected")

    settings = get_settings()
    trello = TrelloOAuthService(settings)
    tokens = integration["tokens"]
    try:
        cards = await trello.list_cards(tokens)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list Trello cards: {exc}") from exc

    return [ExternalCardPreview(**trello.card_to_preview(c)) for c in cards]


# --- GitHub OAuth 2.0 ---

@router.get("/github/authorize")
def github_authorize(user_id: str = Depends(get_user_id)):
    settings = get_settings()
    if not settings.github_client_id or not settings.github_client_secret:
        raise HTTPException(status_code=503, detail="GitHub OAuth is not configured on the server")

    github = GitHubOAuthService(settings)
    state = github.generate_state()
    _oauth_states[state] = {"user_id": user_id, "provider": "github"}
    return {"authorize_url": github.build_authorize_url(state)}


@router.get("/github/callback")
async def github_callback(code: str = Query(...), state: str = Query(...)):
    pending = _oauth_states.pop(state, None)
    if not pending:
        return RedirectResponse(_frontend_integrations_url("error", "github"))

    settings = get_settings()
    github = GitHubOAuthService(settings)
    user_id = pending["user_id"]

    try:
        token_data = await github.exchange_code(code)
        user = await github.get_user(token_data["access_token"])
        account_label = user.get("login") or user.get("name") or "GitHub"

        tokens = {
            "access_token": token_data["access_token"],
            "token_type": token_data.get("token_type", "bearer"),
            "scope": token_data.get("scope"),
        }
        db = get_firestore()
        db.save_integration(user_id, IntegrationProvider.GITHUB.value, tokens, account_label)
        return RedirectResponse(_frontend_integrations_url("connected", "github"))
    except Exception:
        return RedirectResponse(_frontend_integrations_url("error", "github"))


# --- Zendesk OAuth 2.0 ---


@router.get("/zendesk/authorize")
def zendesk_authorize(
    subdomain: str = Query(..., min_length=1, description="Zendesk subdomain, e.g. your-company"),
    user_id: str = Depends(get_user_id),
):
    settings = get_settings()
    if not settings.zendesk_client_id or not settings.zendesk_client_secret:
        raise HTTPException(status_code=503, detail="Zendesk OAuth is not configured on the server")

    zendesk = ZendeskOAuthService(settings)
    try:
        normalized = zendesk.validate_subdomain(subdomain)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    state = zendesk.generate_state()
    _oauth_states[state] = {
        "user_id": user_id,
        "provider": "zendesk",
        "subdomain": normalized,
    }
    return {"authorize_url": zendesk.build_authorize_url(normalized, state)}


@router.get("/zendesk/callback")
async def zendesk_callback(code: str = Query(...), state: str = Query(...)):
    pending = _oauth_states.pop(state, None)
    if not pending:
        return RedirectResponse(_frontend_integrations_url("error", "zendesk"))

    settings = get_settings()
    zendesk = ZendeskOAuthService(settings)
    user_id = pending["user_id"]
    subdomain = pending.get("subdomain")
    if not subdomain:
        return RedirectResponse(_frontend_integrations_url("error", "zendesk"))

    try:
        token_data = await zendesk.exchange_code(subdomain, code)
        tokens = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "token_type": token_data.get("token_type", "bearer"),
            "obtained_at": token_data.get("obtained_at", time.time()),
            "subdomain": token_data["subdomain"],
        }
        user = await zendesk.get_current_user(tokens)
        account_label = user.get("name") or user.get("email") or subdomain

        db = get_firestore()
        db.save_integration(user_id, IntegrationProvider.ZENDESK.value, tokens, account_label)
        return RedirectResponse(_frontend_integrations_url("connected", "zendesk"))
    except Exception:
        return RedirectResponse(_frontend_integrations_url("error", "zendesk"))


async def _zendesk_tokens_for_user(user_id: str) -> tuple[ZendeskOAuthService, dict, dict]:
    db = get_firestore()
    integration = db.get_integration(user_id, IntegrationProvider.ZENDESK.value)
    if not integration:
        raise HTTPException(status_code=400, detail="Zendesk is not connected")
    settings = get_settings()
    zendesk = ZendeskOAuthService(settings)
    tokens = await zendesk.get_valid_tokens(integration["tokens"])
    return zendesk, tokens, integration


def _persist_zendesk_tokens_if_changed(
    user_id: str,
    tokens: dict,
    integration: dict,
) -> None:
    if tokens != integration["tokens"]:
        db = get_firestore()
        db.save_integration(
            user_id,
            IntegrationProvider.ZENDESK.value,
            tokens,
            integration.get("account_label"),
        )


@router.get("/zendesk/tickets", response_model=list[ExternalIssuePreview])
async def zendesk_tickets(user_id: str = Depends(get_user_id)):
    zendesk, tokens, integration = await _zendesk_tokens_for_user(user_id)
    subdomain = tokens.get("subdomain", "")
    try:
        tickets = await zendesk.list_tickets(tokens)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list Zendesk tickets: {exc}") from exc

    _persist_zendesk_tokens_if_changed(user_id, tokens, integration)
    return [ExternalIssuePreview(**zendesk.ticket_to_preview(t, subdomain)) for t in tickets]


@router.get("/github/repos", response_model=list[GitHubRepoPreview])
async def github_repos(user_id: str = Depends(get_user_id)):
    db = get_firestore()
    integration = db.get_integration(user_id, IntegrationProvider.GITHUB.value)
    if not integration:
        raise HTTPException(status_code=400, detail="GitHub is not connected")

    settings = get_settings()
    github = GitHubOAuthService(settings)
    try:
        repos = await github.list_repos_for_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to list GitHub repos: {exc}") from exc

    return [GitHubRepoPreview(**github.repo_to_preview(r)) for r in repos]
