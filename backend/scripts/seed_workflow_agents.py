#!/usr/bin/env python3
"""
Seed OpenHands workflow agents (review, test/validation, deploy) in Firestore.

Usage:
  cd backend && .venv/bin/python scripts/seed_workflow_agents.py --user-id <X-User-Id>
  cd backend && .venv/bin/python scripts/seed_workflow_agents.py --discover-user
  cd backend && .venv/bin/python scripts/seed_workflow_agents.py --discover-user --update-applications

Uses LLM_* from backend/.env for the shared LiteLLM profile.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.services.firestore import get_firestore  # noqa: E402

WORKFLOW_AGENT_SPECS: list[dict] = [
    {
        "agent_id": "develop-agent",
        "display_name": "Development agent",
        "description": "Implements goals: code changes, branches, tests in-repo.",
        "system_prompt": (
            "You are the DEVELOPMENT agent. Implement minimal, production-quality changes. "
            "Follow repository conventions, add or update tests when appropriate, and "
            "write clear commits on the feature branch."
        ),
        "critic_enabled": False,
    },
    {
        "agent_id": "review-agent",
        "display_name": "Review agent",
        "description": "Reviews diffs for correctness, security, and maintainability.",
        "system_prompt": (
            "You are the CODE REVIEW agent. Review changes critically but fairly. "
            "Approve only when the change set is ready for automated testing. "
            "Be specific in feedback when requesting changes."
        ),
        "critic_enabled": False,
    },
    {
        "agent_id": "test-agent",
        "display_name": "Test validation agent",
        "description": "Runs project tests and lint; reports failures clearly.",
        "system_prompt": (
            "You are the TEST VALIDATION agent. Run the project's test and lint commands. "
            "Fix only clear regressions you introduced; otherwise report failures in feedback. "
            "Pass only when validations succeed."
        ),
        "critic_enabled": False,
    },
    {
        "agent_id": "deploy-agent",
        "display_name": "Deployment agent",
        "description": "Pushes branches and opens pull requests when the pipeline passes.",
        "system_prompt": (
            "You are the DEPLOYMENT agent. Ensure the feature branch is pushed and open a "
            "pull request with a clear title and description. Verify deployment readiness "
            "checks required by the repository."
        ),
        "critic_enabled": False,
    },
]


def discover_user_id(db) -> str | None:
    for coll in ("applications", "agents", "llm_profiles"):
        for doc in db.db.collection(coll).limit(5).stream():
            uid = (doc.to_dict() or {}).get("user_id")
            if uid:
                return str(uid)
    return None


def ensure_llm_profile(db, user_id: str, settings) -> str:
    profiles = db.list_llm_profiles(user_id)
    if profiles:
        print(f"Using existing LLM profile: {profiles[0]['display_name']} ({profiles[0]['id']})")
        return profiles[0]["id"]

    api_key = (settings.llm_api_key or "").strip()
    base_url = (settings.llm_base_url or "").strip().rstrip("/")
    model = (settings.llm_model or "").strip()
    if not api_key or not base_url or not model:
        raise RuntimeError(
            "Set LLM_API_KEY, LLM_BASE_URL, and LLM_MODEL in backend/.env to create an LLM profile."
        )

    row = db.create_llm_profile(
        user_id=user_id,
        display_name="Default LiteLLM",
        description="Shared LiteLLM gateway for workflow agents",
        vendor_type="litellm",
        base_url=base_url,
        model=model,
        api_key=api_key,
    )
    print(f"Created LLM profile: {row['display_name']} ({row['id']})")
    return row["id"]


def seed_agents(db, user_id: str, llm_profile_id: str) -> dict[str, str]:
    """Returns workflow_roles map: role -> firestore record id."""
    roles: dict[str, str] = {}
    role_by_agent_id = {
        "develop-agent": "develop",
        "review-agent": "review",
        "test-agent": "test",
        "deploy-agent": "deploy",
    }

    for spec in WORKFLOW_AGENT_SPECS:
        agent_id = spec["agent_id"]
        existing = db.get_agent_by_agent_id(user_id, agent_id)
        if existing:
            print(f"Agent already exists: {agent_id} ({existing['id']})")
            record_id = existing["id"]
        else:
            row = db.create_agent(
                user_id=user_id,
                agent_id=agent_id,
                display_name=spec["display_name"],
                description=spec["description"],
                system_prompt=spec["system_prompt"],
                llm_profile_id=llm_profile_id,
                critic_enabled=spec.get("critic_enabled", False),
            )
            print(f"Created agent: {agent_id} ({row['id']})")
            record_id = row["id"]

        role = role_by_agent_id.get(agent_id)
        if role:
            roles[role] = record_id

    return roles


def update_applications(db, user_id: str, workflow_roles: dict[str, str]) -> None:
    apps = db.list_applications(user_id)
    if not apps:
        print("No applications to update.")
        return
    for app in apps:
        db.update_application(
            app["id"],
            user_id,
            {
                "workflow_roles": workflow_roles,
                "workflow_max_cycles": int(app.get("workflow_max_cycles") or 3),
            },
        )
        print(f"Updated application workflow_roles: {app['title']} ({app['id']})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed workflow agents in Firestore")
    parser.add_argument("--user-id", default="", help="X-User-Id value (same as frontend)")
    parser.add_argument(
        "--discover-user",
        action="store_true",
        help="Use user_id from first application/agent document",
    )
    parser.add_argument(
        "--update-applications",
        action="store_true",
        help="Set workflow_roles on all applications for this user",
    )
    args = parser.parse_args()

    settings = get_settings()
    db = get_firestore()

    user_id = args.user_id.strip()
    if args.discover_user or not user_id:
        discovered = discover_user_id(db)
        if discovered:
            user_id = discovered
            print(f"Discovered user_id: {user_id}")
    if not user_id:
        print("Provide --user-id or --discover-user", file=sys.stderr)
        sys.exit(2)

    llm_profile_id = ensure_llm_profile(db, user_id, settings)
    workflow_roles = seed_agents(db, user_id, llm_profile_id)

    print("\nWorkflow role → agent record IDs:")
    for role, rid in workflow_roles.items():
        print(f"  {role}: {rid}")

    if args.update_applications:
        update_applications(db, user_id, workflow_roles)

    print("\nDone.")


if __name__ == "__main__":
    main()
