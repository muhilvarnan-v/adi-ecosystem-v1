"""Create GitHub pull requests from a downloaded sandbox workspace."""

from __future__ import annotations

import tarfile
import tempfile
from pathlib import Path

import httpx

from app.services.github_sandbox import DEFAULT_REPO_MOUNT, normalize_repo_url

GITHUB_API = "https://api.github.com"


def _parse_owner_repo(repo_url: str) -> tuple[str, str]:
    path = normalize_repo_url(repo_url).replace("https://github.com/", "")
    owner, repo = path.split("/", 1)
    return owner, repo


def _find_repo_root(extract_dir: Path) -> Path | None:
    mount = DEFAULT_REPO_MOUNT.lstrip("/")
    candidate = extract_dir / mount
    if candidate.is_dir() and (candidate / ".git").exists():
        return candidate
    for git_dir in extract_dir.rglob(".git"):
        if git_dir.is_dir():
            return git_dir.parent
    return None


async def create_pr_from_snapshot(
    *,
    access_token: str,
    repo_url: str,
    base_branch: str,
    head_branch: str,
    title: str,
    body: str,
    tar_bytes: bytes,
) -> str:
    """
    Push changed files from an environment snapshot tar and open a PR.
    Falls back when the agent did not return PR_URL.
    """
    owner, repo = _parse_owner_repo(repo_url)

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "snapshot.tar"
        tar_path.write_bytes(tar_bytes)
        extract_dir = Path(tmp) / "extracted"
        extract_dir.mkdir()
        with tarfile.open(tar_path) as tar:
            tar.extractall(path=extract_dir)

        repo_root = _find_repo_root(extract_dir)
        if repo_root is None:
            raise RuntimeError("Could not find repository root in environment snapshot")

        async with httpx.AsyncClient(timeout=120.0) as client:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            base_ref = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}/git/ref/heads/{base_branch}",
                headers=headers,
            )
            base_ref.raise_for_status()
            base_sha = base_ref.json()["object"]["sha"]

            try:
                await client.post(
                    f"{GITHUB_API}/repos/{owner}/{repo}/git/refs",
                    headers=headers,
                    json={"ref": f"refs/heads/{head_branch}", "sha": base_sha},
                )
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code != 422:
                    raise

            tree_entries: list[dict] = []
            for file_path in sorted(repo_root.rglob("*")):
                if not file_path.is_file():
                    continue
                rel = file_path.relative_to(repo_root).as_posix()
                if rel == ".git" or rel.startswith(".git/"):
                    continue
                try:
                    content = file_path.read_bytes()
                except OSError:
                    continue
                if len(content) > 1_000_000:
                    continue
                blob_resp = await client.post(
                    f"{GITHUB_API}/repos/{owner}/{repo}/git/blobs",
                    headers=headers,
                    json={
                        "content": content.decode("utf-8", errors="surrogateescape"),
                        "encoding": "utf-8",
                    },
                )
                if blob_resp.status_code >= 400:
                    import base64

                    blob_resp = await client.post(
                        f"{GITHUB_API}/repos/{owner}/{repo}/git/blobs",
                        headers=headers,
                        json={
                            "content": base64.b64encode(content).decode("ascii"),
                            "encoding": "base64",
                        },
                    )
                blob_resp.raise_for_status()
                tree_entries.append(
                    {
                        "path": rel,
                        "mode": "100644",
                        "type": "blob",
                        "sha": blob_resp.json()["sha"],
                    }
                )

            if not tree_entries:
                raise RuntimeError("No file changes detected in snapshot for PR")

            tree_resp = await client.post(
                f"{GITHUB_API}/repos/{owner}/{repo}/git/trees",
                headers=headers,
                json={"base_tree": base_sha, "tree": tree_entries},
            )
            tree_resp.raise_for_status()
            new_tree_sha = tree_resp.json()["sha"]

            commit_resp = await client.post(
                f"{GITHUB_API}/repos/{owner}/{repo}/git/commits",
                headers=headers,
                json={
                    "message": title,
                    "tree": new_tree_sha,
                    "parents": [base_sha],
                },
            )
            commit_resp.raise_for_status()
            commit_sha = commit_resp.json()["sha"]

            await client.patch(
                f"{GITHUB_API}/repos/{owner}/{repo}/git/refs/heads/{head_branch}",
                headers=headers,
                json={"sha": commit_sha, "force": True},
            )

            pr_resp = await client.post(
                f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
                headers=headers,
                json={
                    "title": title,
                    "body": body,
                    "head": head_branch,
                    "base": base_branch,
                },
            )
            pr_resp.raise_for_status()
            return pr_resp.json()["html_url"]
