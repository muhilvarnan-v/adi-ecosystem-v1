"""Resolve skill files and sync GitHub-backed skills to the GCP Skill Registry."""

from __future__ import annotations

import asyncio
from typing import Any

from app.config import Settings, get_settings
from app.schemas.skill import SkillSource
from app.services.github_oauth import GitHubOAuthService
from app.services.github_tokens import resolve_github_token
from app.services.skill_registry import SkillRegistryService


async def resolve_skill_files(skill_row: dict[str, Any], user_id: str) -> dict[str, bytes]:
    """Load skill files for OpenHands (AgentSkills layout) or registry upload."""
    source = skill_row.get("source", SkillSource.MANUAL.value)

    if source == SkillSource.GITHUB.value:
        repo = (skill_row.get("github_repo") or "").strip()
        if not repo or "/" not in repo:
            raise ValueError(f"Skill {skill_row.get('skill_id')} is missing github_repo")
        owner, repo_name = repo.split("/", 1)
        token = resolve_github_token(user_id)
        if not token:
            raise ValueError("GitHub is not connected; connect it in Integrations to load skills from repos.")

        settings = get_settings()
        github = GitHubOAuthService(settings)
        patterns = skill_row.get("include_patterns") or [
            "SKILL.md",
            "scripts/**",
            "references/**",
            "assets/**",
        ]
        files = await github.fetch_matching_files(
            token,
            owner,
            repo_name,
            skill_row.get("github_branch") or "main",
            skill_row.get("github_base_path") or "",
            patterns,
        )
        if not files:
            raise ValueError(f"No files matched for skill {skill_row.get('skill_id')}")
        if "SKILL.md" not in files and not any(p.endswith("SKILL.md") for p in files):
            raise ValueError(f"Skill {skill_row.get('skill_id')} must include SKILL.md")
        return files

    files: dict[str, bytes] = {}
    skill_md = (skill_row.get("skill_md") or "").strip()
    if not skill_md:
        raise ValueError(
            f"Manual skill {skill_row.get('skill_id')} has no stored SKILL.md content. "
            "Re-create or edit the skill in Harness → Skills."
        )
    files["SKILL.md"] = skill_md.encode("utf-8")
    for item in skill_row.get("additional_files") or []:
        path = str(item.get("path", "")).lstrip("/")
        content = str(item.get("content", ""))
        if path:
            files[path] = content.encode("utf-8")
    return files


async def sync_skill_to_registry(skill_row: dict[str, Any], user_id: str) -> None:
    """Upload the latest skill files to GCP Skill Registry (create or update)."""
    settings = get_settings()
    registry = SkillRegistryService(settings)
    skill_id = skill_row["skill_id"]
    files = await resolve_skill_files(skill_row, user_id)

    try:
        await registry.update_skill(
            skill_id=skill_id,
            display_name=skill_row.get("display_name"),
            description=skill_row.get("description"),
            files=files,
        )
    except Exception:
        await registry.create_skill(
            skill_id=skill_id,
            display_name=skill_row["display_name"],
            description=skill_row.get("description", ""),
            files=files,
        )


async def sync_environment_skills(environment_row: dict[str, Any], user_id: str) -> None:
    """Refresh all skills attached to an environment before agent registration."""
    db = get_firestore()
    attachments = environment_row.get("skill_attachments") or []
    if not attachments:
        return

    skill_ids = {a["skill_id"] for a in attachments}
    by_skill_id = {s["skill_id"]: s for s in db.list_skills(user_id) if s["skill_id"] in skill_ids}

    for attachment in attachments:
        skill_row = by_skill_id.get(attachment["skill_id"])
        if not skill_row:
            continue
        await sync_skill_to_registry(skill_row, user_id)


def sync_environment_skills_blocking(environment_row: dict[str, Any], user_id: str) -> None:
    asyncio.run(sync_environment_skills(environment_row, user_id))


async def resolve_environment_skill_payloads(
    environment_row: dict[str, Any],
    user_id: str,
) -> list[dict[str, Any]]:
    """Build OpenHands execution payloads: [{skill_id, files: {path: text}}, ...]."""
    db = get_firestore()
    attachments = environment_row.get("skill_attachments") or []
    if not attachments:
        return []

    skill_ids = {a["skill_id"] for a in attachments}
    by_skill_id = {s["skill_id"]: s for s in db.list_skills(user_id) if s["skill_id"] in skill_ids}

    payloads: list[dict[str, Any]] = []
    for attachment in attachments:
        skill_row = by_skill_id.get(attachment["skill_id"])
        if not skill_row:
            continue
        files = await resolve_skill_files(skill_row, user_id)
        payloads.append(
            {
                "skill_id": skill_row["skill_id"],
                "display_name": skill_row.get("display_name", skill_row["skill_id"]),
                "files": {path: content.decode("utf-8") for path, content in files.items()},
            }
        )
    return payloads


def resolve_agent_skills_for_execution(agent_row: dict[str, Any], user_id: str) -> list[dict[str, Any]]:
    """Load skills for an agent's environment (fresh GitHub fetch when configured)."""
    env_id = agent_row.get("environment_id")
    if not env_id:
        return []
    db = get_firestore()
    environment_row = db.get_environment(env_id, user_id)
    if not environment_row:
        return []
    return asyncio.run(resolve_environment_skill_payloads(environment_row, user_id))
