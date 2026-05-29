from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore

from app.config import get_settings

APPLICATIONS_COLLECTION = "applications"
GOALS_COLLECTION = "goals"
INTEGRATIONS_COLLECTION = "integrations"
SKILLS_COLLECTION = "skills"
ENVIRONMENTS_COLLECTION = "environments"  # legacy collection name; Harness UI: sandbox environments
AGENTS_COLLECTION = "agents"
MCP_SERVERS_COLLECTION = "mcp_servers"
LLM_PROFILES_COLLECTION = "llm_profiles"
USER_WORKFLOWS_COLLECTION = "user_workflows"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class FirestoreService:
    def __init__(self) -> None:
        settings = get_settings()
        kwargs: dict[str, Any] = {}
        if settings.firestore_project_id:
            kwargs["project"] = settings.firestore_project_id
        self._db = firestore.Client(**kwargs)

    @property
    def db(self) -> firestore.Client:
        return self._db

    # --- Applications ---

    def create_application(
        self,
        user_id: str,
        title: str,
        description: str,
        github_repo_url: str | None = None,
        workflow_roles: dict[str, str] | None = None,
        workflow_max_cycles: int = 3,
    ) -> dict[str, Any]:
        now = _utc_now()
        data = {
            "user_id": user_id,
            "title": title,
            "description": description,
            "github_repo_url": github_repo_url,
            "workflow_roles": workflow_roles or {},
            "workflow_max_cycles": workflow_max_cycles,
            "created_at": now,
            "updated_at": now,
        }
        _, ref = self._db.collection(APPLICATIONS_COLLECTION).add(data)
        data["id"] = ref.id
        return data

    def list_applications(self, user_id: str) -> list[dict[str, Any]]:
        query = (
            self._db.collection(APPLICATIONS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        )
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    def get_application(self, application_id: str, user_id: str) -> dict[str, Any] | None:
        doc = self._db.collection(APPLICATIONS_COLLECTION).document(application_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        row["id"] = doc.id
        return row

    def update_application(
        self,
        application_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        ref = self._db.collection(APPLICATIONS_COLLECTION).document(application_id)
        doc = ref.get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        updates["updated_at"] = _utc_now()
        ref.update(updates)
        row.update(updates)
        row["id"] = application_id
        return row

    def delete_application(self, application_id: str, user_id: str) -> bool:
        ref = self._db.collection(APPLICATIONS_COLLECTION).document(application_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if doc.to_dict().get("user_id") != user_id:
            return False
        for goal in self.list_goals(user_id, application_id=application_id):
            self._db.collection(GOALS_COLLECTION).document(goal["id"]).delete()
        ref.delete()
        return True

    # --- User-scoped workflow templates (not tied to applications) ---

    def get_user_workflows_row(self, user_id: str) -> dict[str, Any]:
        doc = self._db.collection(USER_WORKFLOWS_COLLECTION).document(user_id).get()
        if not doc.exists:
            return {"workflows": [], "updated_at": None}
        row = doc.to_dict() or {}
        raw = row.get("workflows")
        workflows = raw if isinstance(raw, list) else []
        return {"workflows": workflows, "updated_at": row.get("updated_at")}

    def set_user_workflows(self, user_id: str, workflows: list[dict[str, Any]]) -> dict[str, Any]:
        now = _utc_now()
        ref = self._db.collection(USER_WORKFLOWS_COLLECTION).document(user_id)
        ref.set({"user_id": user_id, "workflows": workflows, "updated_at": now})
        return {"workflows": workflows, "updated_at": now}

    # --- Goals ---

    def create_goal(
        self,
        user_id: str,
        title: str,
        description: str,
        source: str,
        application_id: str,
        external_id: str | None = None,
        external_url: str | None = None,
        agent_record_id: str | None = None,
        workflow_roles: dict[str, str] | None = None,
        workflow_id: str | None = None,
        workflow_steps: list[str] | None = None,
        workflow_max_cycles: int | None = None,
        *,
        status: str = "backlog",
        execution_status: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now()
        data = {
            "user_id": user_id,
            "application_id": application_id,
            "title": title,
            "description": description,
            "source": source,
            "status": status,
            "external_id": external_id,
            "external_url": external_url,
            "agent_record_id": agent_record_id,
            "workflow_roles": workflow_roles or {},
            "workflow_id": workflow_id,
            "workflow_steps": workflow_steps or [],
            "workflow_max_cycles": workflow_max_cycles,
            "interaction_id": None,
            "runtime_environment_id": None,
            "execution_status": execution_status,
            "execution_error": None,
            "pr_url": None,
            "execution_log": None,
            "workflow_graph": None,
            "created_at": now,
            "updated_at": now,
        }
        _, ref = self._db.collection(GOALS_COLLECTION).add(data)
        data["id"] = ref.id
        return data

    def list_goals(
        self,
        user_id: str,
        application_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = self._db.collection(GOALS_COLLECTION).where(filter=firestore.FieldFilter("user_id", "==", user_id))
        if application_id is not None:
            query = query.where(filter=firestore.FieldFilter("application_id", "==", application_id))
        query = query.order_by("created_at", direction=firestore.Query.DESCENDING)
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    def get_goal(self, goal_id: str, user_id: str) -> dict[str, Any] | None:
        doc = self._db.collection(GOALS_COLLECTION).document(goal_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        row["id"] = doc.id
        return row

    def update_goal(
        self,
        goal_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        ref = self._db.collection(GOALS_COLLECTION).document(goal_id)
        doc = ref.get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        updates["updated_at"] = _utc_now()
        ref.update(updates)
        row.update(updates)
        row["id"] = goal_id
        return row

    def delete_goal(self, goal_id: str, user_id: str) -> bool:
        ref = self._db.collection(GOALS_COLLECTION).document(goal_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True

    # --- Integrations (doc id: {user_id}_{provider}) ---

    def _integration_doc_id(self, user_id: str, provider: str) -> str:
        return f"{user_id}_{provider}"

    def save_integration(
        self,
        user_id: str,
        provider: str,
        tokens: dict[str, Any],
        account_label: str | None = None,
    ) -> dict[str, Any]:
        doc_id = self._integration_doc_id(user_id, provider)
        now = _utc_now()
        data = {
            "user_id": user_id,
            "provider": provider,
            "tokens": tokens,
            "account_label": account_label,
            "connected_at": now,
            "updated_at": now,
        }
        self._db.collection(INTEGRATIONS_COLLECTION).document(doc_id).set(data)
        data["id"] = doc_id
        return data

    def get_integration(self, user_id: str, provider: str) -> dict[str, Any] | None:
        doc_id = self._integration_doc_id(user_id, provider)
        doc = self._db.collection(INTEGRATIONS_COLLECTION).document(doc_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        row["id"] = doc.id
        return row

    def delete_integration(self, user_id: str, provider: str) -> bool:
        doc_id = self._integration_doc_id(user_id, provider)
        ref = self._db.collection(INTEGRATIONS_COLLECTION).document(doc_id)
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    def list_integrations(self, user_id: str) -> list[dict[str, Any]]:
        query = self._db.collection(INTEGRATIONS_COLLECTION).where(filter=firestore.FieldFilter("user_id", "==", user_id))
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    # --- Skills (GCP Skill Registry metadata) ---

    def create_skill(
        self,
        user_id: str,
        skill_id: str,
        display_name: str,
        description: str,
        source: str,
        gcp_name: str | None = None,
        state: str | None = None,
        github_repo: str | None = None,
        github_branch: str | None = None,
        github_base_path: str | None = None,
        include_patterns: list[str] | None = None,
        skill_md: str | None = None,
        additional_files: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        now = _utc_now()
        data = {
            "user_id": user_id,
            "skill_id": skill_id,
            "display_name": display_name,
            "description": description,
            "source": source,
            "gcp_name": gcp_name,
            "state": state,
            "github_repo": github_repo,
            "github_branch": github_branch,
            "github_base_path": github_base_path,
            "include_patterns": include_patterns,
            "skill_md": skill_md,
            "additional_files": additional_files or [],
            "created_at": now,
            "updated_at": now,
        }
        _, ref = self._db.collection(SKILLS_COLLECTION).add(data)
        data["id"] = ref.id
        return data

    def list_skills(self, user_id: str) -> list[dict[str, Any]]:
        query = (
            self._db.collection(SKILLS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        )
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    def get_skill(self, record_id: str, user_id: str) -> dict[str, Any] | None:
        doc = self._db.collection(SKILLS_COLLECTION).document(record_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        row["id"] = doc.id
        return row

    def get_skill_by_skill_id(self, user_id: str, skill_id: str) -> dict[str, Any] | None:
        query = (
            self._db.collection(SKILLS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .where(filter=firestore.FieldFilter("skill_id", "==", skill_id))
            .limit(1)
        )
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            return row
        return None

    def update_skill(
        self,
        record_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        ref = self._db.collection(SKILLS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        updates["updated_at"] = _utc_now()
        ref.update(updates)
        row.update(updates)
        row["id"] = record_id
        return row

    def delete_skill(self, record_id: str, user_id: str) -> bool:
        ref = self._db.collection(SKILLS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True

    # --- Environments (sandbox configs for managed agents) ---

    def create_environment(
        self,
        user_id: str,
        env_id: str,
        display_name: str,
        description: str,
        skill_attachments: list[dict[str, Any]],
        additional_sources: list[dict[str, Any]],
        network_mode: str,
        network_allowlist: list[dict[str, Any]],
        runtime_environment_id: str | None = None,
        *,
        sandbox_type: str = "docker",
        docker_server_image: str = "ghcr.io/openhands/agent-server:latest-python",
        docker_host_port: int = 3000,
        remote_runtime_api_url: str = "",
        remote_runtime_api_key: str = "",
        remote_server_image: str = "",
    ) -> dict[str, Any]:
        now = _utc_now()
        data = {
            "user_id": user_id,
            "env_id": env_id,
            "display_name": display_name,
            "description": description,
            "skill_attachments": skill_attachments,
            "additional_sources": additional_sources,
            "network_mode": network_mode,
            "network_allowlist": network_allowlist,
            "runtime_environment_id": runtime_environment_id,
            "sandbox_type": sandbox_type,
            "docker_server_image": docker_server_image,
            "docker_host_port": docker_host_port,
            "remote_runtime_api_url": remote_runtime_api_url,
            "remote_runtime_api_key": remote_runtime_api_key,
            "remote_server_image": remote_server_image,
            "created_at": now,
            "updated_at": now,
        }
        _, ref = self._db.collection(ENVIRONMENTS_COLLECTION).add(data)
        data["id"] = ref.id
        return data

    def list_environments(self, user_id: str) -> list[dict[str, Any]]:
        query = (
            self._db.collection(ENVIRONMENTS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        )
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    def get_environment(self, record_id: str, user_id: str) -> dict[str, Any] | None:
        doc = self._db.collection(ENVIRONMENTS_COLLECTION).document(record_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        row["id"] = doc.id
        return row

    def get_environment_by_env_id(self, user_id: str, env_id: str) -> dict[str, Any] | None:
        query = (
            self._db.collection(ENVIRONMENTS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .where(filter=firestore.FieldFilter("env_id", "==", env_id))
            .limit(1)
        )
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            return row
        return None

    def update_environment(
        self,
        record_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        ref = self._db.collection(ENVIRONMENTS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        updates["updated_at"] = _utc_now()
        ref.update(updates)
        row.update(updates)
        row["id"] = record_id
        return row

    def delete_environment(self, record_id: str, user_id: str) -> bool:
        ref = self._db.collection(ENVIRONMENTS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True

    # --- Agents (managed agents API configs) ---

    def create_agent(
        self,
        user_id: str,
        agent_id: str,
        display_name: str,
        description: str,
        *,
        system_prompt: str = "",
        environment_id: str | None = None,
        mcp_server_ids: list[str] | None = None,
        llm_profile_id: str | None = None,
        llm_model: str | None = None,
        tools: list[str] | None = None,
        load_project_skills: bool = True,
        condenser_enabled: bool = True,
        condenser_max_size: int = 240,
        critic_enabled: bool = False,
        critic_mode: str = "finish_and_message",
        enable_iterative_refinement: bool = False,
        critic_threshold: float = 0.6,
        max_refinement_iterations: int = 3,
        confirmation_mode: bool = False,
        security_analyzer: str = "llm",
    ) -> dict[str, Any]:
        now = _utc_now()
        data = {
            "user_id": user_id,
            "agent_id": agent_id,
            "display_name": display_name,
            "description": description,
            "agent_kind": "openhands",
            "system_prompt": system_prompt,
            "environment_id": environment_id,
            "mcp_server_ids": mcp_server_ids or [],
            "llm_profile_id": llm_profile_id,
            "llm_model": llm_model,
            "tools": tools or ["terminal", "file_editor", "task_tracker"],
            "load_project_skills": load_project_skills,
            "condenser_enabled": condenser_enabled,
            "condenser_max_size": condenser_max_size,
            "critic_enabled": critic_enabled,
            "critic_mode": critic_mode,
            "enable_iterative_refinement": enable_iterative_refinement,
            "critic_threshold": critic_threshold,
            "max_refinement_iterations": max_refinement_iterations,
            "confirmation_mode": confirmation_mode,
            "security_analyzer": security_analyzer,
            "created_at": now,
            "updated_at": now,
        }
        _, ref = self._db.collection(AGENTS_COLLECTION).add(data)
        data["id"] = ref.id
        return data

    def list_agents(self, user_id: str) -> list[dict[str, Any]]:
        query = (
            self._db.collection(AGENTS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        )
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    def get_agent(self, record_id: str, user_id: str) -> dict[str, Any] | None:
        doc = self._db.collection(AGENTS_COLLECTION).document(record_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        row["id"] = doc.id
        return row

    def get_agent_by_agent_id(self, user_id: str, agent_id: str) -> dict[str, Any] | None:
        query = (
            self._db.collection(AGENTS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .where(filter=firestore.FieldFilter("agent_id", "==", agent_id))
            .limit(1)
        )
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            return row
        return None

    def update_agent(
        self,
        record_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        ref = self._db.collection(AGENTS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        updates["updated_at"] = _utc_now()
        ref.update(updates)
        row.update(updates)
        row["id"] = record_id
        return row

    def delete_agent(self, record_id: str, user_id: str) -> bool:
        ref = self._db.collection(AGENTS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True

    # --- LLM profiles (LiteLLM gateways for OpenHands agents) ---

    def create_llm_profile(
        self,
        user_id: str,
        display_name: str,
        description: str,
        vendor_type: str,
        base_url: str,
        model: str,
        api_key: str,
    ) -> dict[str, Any]:
        now = _utc_now()
        data = {
            "user_id": user_id,
            "display_name": display_name,
            "description": description,
            "vendor_type": vendor_type,
            "base_url": base_url,
            "model": model,
            "api_key": api_key,
            "created_at": now,
            "updated_at": now,
        }
        _, ref = self._db.collection(LLM_PROFILES_COLLECTION).add(data)
        data["id"] = ref.id
        return data

    def list_llm_profiles(self, user_id: str) -> list[dict[str, Any]]:
        query = (
            self._db.collection(LLM_PROFILES_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        )
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    def get_llm_profile(self, record_id: str, user_id: str) -> dict[str, Any] | None:
        doc = self._db.collection(LLM_PROFILES_COLLECTION).document(record_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        row["id"] = doc.id
        return row

    def update_llm_profile(
        self,
        record_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        ref = self._db.collection(LLM_PROFILES_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        updates["updated_at"] = _utc_now()
        ref.update(updates)
        row.update(updates)
        row["id"] = record_id
        return row

    def delete_llm_profile(self, record_id: str, user_id: str) -> bool:
        ref = self._db.collection(LLM_PROFILES_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True

    # --- MCP servers (Model Context Protocol tools in Harness) ---

    def create_mcp_server(
        self,
        user_id: str,
        name: str,
        url: str,
        header_key: str,
        header_value: str,
        description: str,
    ) -> dict[str, Any]:
        now = _utc_now()
        data = {
            "user_id": user_id,
            "name": name,
            "url": url,
            "header_key": header_key,
            "header_value": header_value,
            "description": description,
            "created_at": now,
            "updated_at": now,
        }
        _, ref = self._db.collection(MCP_SERVERS_COLLECTION).add(data)
        data["id"] = ref.id
        return data

    def list_mcp_servers(self, user_id: str) -> list[dict[str, Any]]:
        query = (
            self._db.collection(MCP_SERVERS_COLLECTION)
            .where(filter=firestore.FieldFilter("user_id", "==", user_id))
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        )
        results = []
        for doc in query.stream():
            row = doc.to_dict()
            row["id"] = doc.id
            results.append(row)
        return results

    def get_mcp_server(self, record_id: str, user_id: str) -> dict[str, Any] | None:
        doc = self._db.collection(MCP_SERVERS_COLLECTION).document(record_id).get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        row["id"] = doc.id
        return row

    def update_mcp_server(
        self,
        record_id: str,
        user_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        ref = self._db.collection(MCP_SERVERS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return None
        row = doc.to_dict()
        if row.get("user_id") != user_id:
            return None
        updates["updated_at"] = _utc_now()
        ref.update(updates)
        row.update(updates)
        row["id"] = record_id
        return row

    def delete_mcp_server(self, record_id: str, user_id: str) -> bool:
        ref = self._db.collection(MCP_SERVERS_COLLECTION).document(record_id)
        doc = ref.get()
        if not doc.exists:
            return False
        if doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True


_firestore_service: FirestoreService | None = None


def get_firestore() -> FirestoreService:
    global _firestore_service
    if _firestore_service is None:
        _firestore_service = FirestoreService()
    return _firestore_service
