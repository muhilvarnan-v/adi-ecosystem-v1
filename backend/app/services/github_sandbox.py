"""GitHub repository environments for Managed Agents (clone + PR workflow)."""

from __future__ import annotations

import base64
import re
from typing import Any

DEFAULT_REPO_MOUNT = "/workspace/repo"


def normalize_repo_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]
    if not url.startswith("https://github.com/"):
        raise ValueError(
            f"Repo URL must be https://github.com/owner/repo (got {url!r})"
        )
    return url


def repo_slug_from_url(repo_url: str) -> str:
    parts = normalize_repo_url(repo_url).replace("https://github.com/", "").split("/")
    if len(parts) < 2:
        raise ValueError(f"Invalid GitHub repo URL: {repo_url}")
    return f"{parts[0]}-{parts[1]}"


def slugify(text: str, max_len: int = 36) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        slug = "task"
    return slug[:max_len].rstrip("-")


def github_basic_auth_header(token: str) -> str:
    encoded = base64.b64encode(f"x-oauth-basic:{token}".encode()).decode("ascii")
    return f"Basic {encoded}"


def normalize_sandbox_network(
    network: Any | None = None,
) -> dict[str, Any] | str | None:
    """
    Gemini managed-environment preview only accepts allowlist: [{"domain": "*"}].
    Per-domain rules and header transforms are rejected with invalid_request.
    """
    if network == "disabled":
        return "disabled"
    if network is None:
        return None
    return {"allowlist": [{"domain": "*"}]}


def build_github_network(_token: str | None = None) -> dict[str, Any]:
    # Wildcard only until the API supports per-domain allowlist + transforms again.
    return {"allowlist": [{"domain": "*"}]}


def repository_source(repo_url: str, target: str = DEFAULT_REPO_MOUNT) -> dict[str, str]:
    return {
        "type": "repository",
        "source": normalize_repo_url(repo_url),
        "target": target,
    }


def merge_environment(
    base: dict[str, Any],
    *,
    repo_url: str | None,
    github_token: str | None,
    extra_sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    env = dict(base)
    sources = list(env.get("sources") or [])
    if extra_sources:
        sources.extend(extra_sources)
    if repo_url:
        sources.append(repository_source(repo_url))
    if sources:
        env["sources"] = sources
    if repo_url:
        env["network"] = build_github_network(github_token)
    elif "network" in env:
        env["network"] = normalize_sandbox_network(env["network"])
    return env


def build_goal_task_prompt(
    *,
    repo_url: str,
    repo_path: str,
    base_branch: str,
    feature_branch: str,
    title: str,
    description: str,
) -> str:
    task_body = title
    if description.strip():
        task_body = f"{title}\n\n{description.strip()}"

    return f"""You are working in a Git repository cloned at `{repo_path}`.

- Repository: {repo_url}
- Base branch: `{base_branch}`
- Feature branch to create: `{feature_branch}`

## Goal
{task_body}

## Required workflow
1. **Configure the sandbox** — inspect the repo (`cd {repo_path}`, `git status`, README). Install dependencies and tooling the project needs (use pip/npm/etc. as appropriate).
2. Fetch/checkout `{base_branch}` and create `{feature_branch}` from it.
3. Implement the goal. Match the repo's style and conventions.
4. Run tests or lint if the project defines them; fix failures you introduce.
5. Stage and commit with a clear message.
6. Push `{feature_branch}` to `origin`.
7. **Open a pull request** into `{base_branch}`:
   - Prefer `gh pr create --base {base_branch} --head {feature_branch} --title "..." --body "..."` when `gh` works.
   - Otherwise use the GitHub REST API with available credentials.

## Final reply format
End with exactly these lines (fill in real values):
```
PR_URL: <url>
BRANCH: {feature_branch}
SUMMARY: <one line>
```
"""


def default_feature_branch(title: str, repo_url: str) -> str:
    slug = slugify(title)
    owner_repo = repo_slug_from_url(repo_url).replace("/", "-")
    return f"agent/{owner_repo}-{slug}"[:80].rstrip("-")


def parse_pr_url(output_text: str | None) -> str | None:
    if not output_text:
        return None
    match = re.search(r"PR_URL:\s*(\S+)", output_text)
    if match:
        url = match.group(1).strip()
        if url.startswith("http"):
            return url
    return None
