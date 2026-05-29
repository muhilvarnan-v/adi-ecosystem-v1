"""Load local agent files into Managed Agents inline environment sources."""

from __future__ import annotations

from pathlib import Path


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_agent_sources(agent_dir: Path) -> list[dict[str, str]]:
    """
    Map a local agent directory to Gemini `base_environment.sources` entries.

    Layout:
      AGENTS.md
      skills/<name>/SKILL.md
      workspace/**  -> mounted under /workspace/
    """
    agent_dir = agent_dir.resolve()
    if not agent_dir.is_dir():
        raise FileNotFoundError(f"Agent directory not found: {agent_dir}")

    sources: list[dict[str, str]] = []

    agents_md = agent_dir / "AGENTS.md"
    if agents_md.is_file():
        sources.append(
            {
                "type": "inline",
                "target": ".agents/AGENTS.md",
                "content": _read_text(agents_md),
            }
        )

    skills_root = agent_dir / "skills"
    if skills_root.is_dir():
        for skill_md in sorted(skills_root.glob("**/SKILL.md")):
            skill_name = skill_md.parent.name
            sources.append(
                {
                    "type": "inline",
                    "target": f".agents/skills/{skill_name}/SKILL.md",
                    "content": _read_text(skill_md),
                }
            )

    workspace_root = agent_dir / "workspace"
    if workspace_root.is_dir():
        for file_path in sorted(workspace_root.rglob("*")):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(workspace_root).as_posix()
            sources.append(
                {
                    "type": "inline",
                    "target": f"/workspace/{rel}",
                    "content": _read_text(file_path),
                }
            )

    if not sources:
        raise ValueError(f"No agent files found under {agent_dir}")

    return sources


DEFAULT_SYSTEM_INSTRUCTION = (
    "You are a specialist in building small FastAPI backends with PostgreSQL "
    "and writing CircleCI 2.1 pipelines. Prefer clear, minimal, runnable code. "
    "Write files to /workspace/output/ unless told otherwise."
)
