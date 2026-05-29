"""Materialize Harness-configured skills into an OpenHands workspace (.agents/skills/)."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def materialize_skills(workspace: Path, skills: list[dict[str, Any]]) -> list[str]:
    """
    Write skills into {workspace}/.agents/skills/{skill_id}/ using the AgentSkills layout.

    Each item in ``skills`` should look like:
      {"skill_id": "my-skill", "files": {"SKILL.md": "...", "scripts/run.sh": "..."}}
    """
    if not skills:
        return []

    skills_root = workspace / ".agents" / "skills"
    skills_root.mkdir(parents=True, exist_ok=True)
    installed: list[str] = []

    for skill in skills:
        skill_id = str(skill.get("skill_id", "")).strip()
        files = skill.get("files") or {}
        if not skill_id or not files:
            continue

        skill_dir = skills_root / skill_id
        skill_dir.mkdir(parents=True, exist_ok=True)

        for rel_path, content in files.items():
            path = skill_dir / str(rel_path).lstrip("/")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(str(content), encoding="utf-8")

        installed.append(skill_id)

    return installed
