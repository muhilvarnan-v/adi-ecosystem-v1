"""Build OpenHands sandbox execution payloads for the coding-agent subprocess."""

from __future__ import annotations

from typing import Any

from app.services.firestore import FirestoreService


def sandbox_execution_dict_from_environment_row(row: dict[str, Any]) -> dict[str, Any]:
    """Shape stored in Firestore → JSON sent to ``run_goal.py`` as ``openhands_sandbox``."""
    kind = str(row.get("sandbox_type") or "docker").strip().lower()
    runtime_working_dir = str(
        row.get("runtime_working_dir")
        or row.get("working_dir")
        or row.get("remote_working_dir")
        or ""
    ).strip()
    if kind == "remote":
        url = (row.get("remote_runtime_api_url") or "").strip()
        key = (row.get("remote_runtime_api_key") or "").strip()
        img = (row.get("remote_server_image") or "").strip()
        if not url:
            raise ValueError("Remote sandbox is missing runtime_api_url")
        if not key:
            raise ValueError("Remote sandbox is missing runtime_api_key")
        if not img:
            raise ValueError("Remote sandbox is missing server_image")
        payload = {
            "kind": "remote",
            "runtime_api_url": url.rstrip("/"),
            "runtime_api_key": key,
            "server_image": img,
        }
        if runtime_working_dir:
            payload["working_dir"] = runtime_working_dir
        return payload

    port = int(row.get("docker_host_port") or 8010)
    image = (row.get("docker_server_image") or "").strip() or "ghcr.io/openhands/agent-server:latest-python"
    payload = {
        "kind": "docker",
        "host_port": port,
        "server_image": image,
        "runtime_host": f"http://127.0.0.1:{port}",
    }
    if runtime_working_dir:
        payload["working_dir"] = runtime_working_dir
    return payload


def resolve_workflow_sandbox_execution(
    db: FirestoreService,
    user_id: str,
    goal_row: dict[str, Any],
) -> dict[str, Any] | None:
    """
    If the goal's selected workflow template has ``sandbox_environment_id``,
    load that environment row and return execution settings for the coding agent.
    """
    wf_id = str(goal_row.get("workflow_id") or "").strip()
    if not wf_id:
        return None
    wf_doc = db.get_user_workflows_row(user_id)
    raw = wf_doc.get("workflows") or []
    if not isinstance(raw, list):
        return None
    for item in raw:
        if not isinstance(item, dict):
            continue
        if str(item.get("id", "")).strip() != wf_id:
            continue
        sid = str(item.get("sandbox_environment_id") or "").strip()
        if not sid:
            return None
        env_row = db.get_environment(sid, user_id)
        if not env_row:
            raise ValueError(
                f"Workflow references sandbox environment id {sid!r}, but that record was not found."
            )
        return sandbox_execution_dict_from_environment_row(env_row)
    return None
