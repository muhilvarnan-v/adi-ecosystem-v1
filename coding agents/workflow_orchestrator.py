"""
Multi-agent implementation workflow: develop → review → test (cycle) → deploy.

Aligns with OpenHands SDK: each phase is a Conversation run with its own Agent
(skills, MCP, system prompt) on a shared workspace (git repo).
"""

from __future__ import annotations

import json
import subprocess
import textwrap
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from agent_session import create_agent_and_conversation
from run_multi_repo import RepoRunResult, parse_result_file

PHASE_RESULT_FILE = ".openhands_phase_result.json"


class WorkflowPhase(str, Enum):
    DEVELOP = "develop"
    REVIEW = "review"
    TEST = "test"
    DEPLOY = "deploy"


@dataclass
class RoleAgentSpec:
    role: str
    agent_record_id: str
    display_name: str
    system_instruction: str = ""
    skills: list[dict[str, Any]] = field(default_factory=list)
    mcp_servers: list[dict[str, Any]] = field(default_factory=list)
    openhands_settings: dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowGraph:
    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)

    def add_node(self, node_id: str, **kwargs: Any) -> None:
        self.nodes.append({"id": node_id, **kwargs})

    def add_edge(self, from_id: str, to_id: str, label: str = "") -> None:
        self.edges.append({"from": from_id, "to": to_id, "label": label})

    def to_dict(self) -> dict[str, Any]:
        return {"nodes": self.nodes, "edges": self.edges}


@dataclass
class PhaseOutcome:
    phase: WorkflowPhase
    cycle: int
    status: str
    summary: str | None = None
    feedback: str | None = None
    pr_url: str | None = None


EmitWorkflow = Callable[[dict[str, Any]], None]
EmitLog = Callable[[str], None]


def _emit_workflow(on_workflow: EmitWorkflow | None, payload: dict[str, Any]) -> None:
    if on_workflow:
        on_workflow(payload)


def _emit_log(on_log: EmitLog | None, line: str) -> None:
    if on_log:
        on_log(line)


def parse_phase_result(path: Path) -> tuple[str, str | None, str | None]:
    if not path.exists():
        return ("failed", None, f"Missing {PHASE_RESULT_FILE}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return ("failed", None, str(exc))
    status = str(payload.get("status", "failed")).strip().lower()
    summary = str(payload.get("summary", "")).strip() or None
    feedback = str(payload.get("feedback", "")).strip() or None
    if status not in ("passed", "failed"):
        status = "failed"
    return status, summary, feedback


def _ensure_pull_request(
    repo_dir: Path,
    base_branch: str,
    feature_branch: str,
    goal: str,
) -> str | None:
    """Deterministically open (or find) a PR for the pushed feature branch via gh.

    Used as a fallback when the deploy agent pushed the branch but did not record
    a PR url. Returns the PR url, or None if it could not be created/found.
    """

    def _gh(args: list[str]) -> subprocess.CompletedProcess | None:
        try:
            return subprocess.run(
                ["gh", *args],
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
                timeout=60,
            )
        except Exception:
            return None

    # Already open?
    existing = _gh(["pr", "view", feature_branch, "--json", "url", "-q", ".url"])
    if existing and existing.returncode == 0 and existing.stdout.strip():
        return existing.stdout.strip()

    title = (goal.strip().splitlines() or ["Automated fix"])[0][:120] or "Automated fix"
    created = _gh(
        [
            "pr",
            "create",
            "--base",
            base_branch,
            "--head",
            feature_branch,
            "--title",
            title,
            "--body",
            "Automated change opened by the ADI agent workflow.\n\n" + goal.strip(),
        ]
    )
    if created and created.returncode == 0 and created.stdout.strip():
        # gh prints the PR url as the last line
        for line in reversed(created.stdout.strip().splitlines()):
            if line.startswith("http"):
                return line.strip()
    # Re-query in case it was created but stdout was unexpected
    again = _gh(["pr", "view", feature_branch, "--json", "url", "-q", ".url"])
    if again and again.returncode == 0 and again.stdout.strip():
        return again.stdout.strip()
    return None


def _has_committed_changes(repo_dir: Path, base_branch: str, feature_branch: str) -> bool:
    """True if the feature branch has committed changes vs base (excluding agent state files)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_dir), "diff", "--name-only", f"{base_branch}...{feature_branch}"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        return True  # fail open: don't block on a git error
    if out.returncode != 0:
        return True
    changed = [
        line.strip()
        for line in out.stdout.splitlines()
        if line.strip() and not line.strip().startswith(".openhands")
    ]
    return len(changed) > 0


def _phase_prompt(
    phase: WorkflowPhase,
    *,
    goal: str,
    base_branch: str,
    feature_branch: str,
    cycle: int,
    feedback: str | None,
) -> str:
    result_hint = textwrap.dedent(
        f"""
        When finished, write `{PHASE_RESULT_FILE}` in the repo root:
        {{
          "status": "passed" | "failed",
          "summary": "<one line>",
          "feedback": "<required when failed; optional when passed>"
        }}
        """
    ).strip()

    feedback_block = ""
    if feedback:
        feedback_block = f"\nPrior cycle feedback to address:\n{feedback}\n"

    if phase == WorkflowPhase.DEVELOP:
        return textwrap.dedent(
            f"""
            You are the DEVELOPMENT agent (cycle {cycle}).
            Implement this goal in the repository:
            {goal}
            {feedback_block}
            Work on branch `{feature_branch}` (create from `{base_branch}` if needed).
            Make minimal, production-quality changes and add/update tests as appropriate.
            Do not open a pull request yet — deployment happens in a later phase.

            {result_hint}
            """
        ).strip()

    if phase == WorkflowPhase.REVIEW:
        return textwrap.dedent(
            f"""
            You are the CODE REVIEW agent (cycle {cycle}).
            Review changes on `{feature_branch}` against `{base_branch}`.
            Check correctness, security, style, and test coverage.
            Set status to "passed" only if the change set is ready for automated testing.

            {result_hint}
            """
        ).strip()

    if phase == WorkflowPhase.TEST:
        return textwrap.dedent(
            f"""
            You are the TEST VALIDATION agent (cycle {cycle}).
            Run the project's test and lint commands. Fix only issues you can verify
            are regressions from this branch; otherwise report them in feedback.
            Set status to "passed" only when validations succeed.

            {result_hint}
            """
        ).strip()

    return textwrap.dedent(
        f"""
        You are the DEPLOYMENT agent.
        Goal context:
        {goal}

        Ensure branch `{feature_branch}` is pushed and open a pull request into `{base_branch}`.
        Run any deployment readiness checks required by the repo.

        Write `{PHASE_RESULT_FILE}` with status passed/failed.
        Also write `.openhands_result.json`:
        {{
          "status": "finished" | "failed",
          "pr_url": "<url or NONE>",
          "summary": "<one line>"
        }}

        End your final message with:
        PR_URL: <url or NONE>
        SUMMARY: <single line>
        """
    ).strip()


def run_phase(
    *,
    phase: WorkflowPhase,
    cycle: int,
    role: RoleAgentSpec,
    repo_dir: Path,
    goal: str,
    base_branch: str,
    feature_branch: str,
    model: str,
    api_key: str,
    feedback: str | None,
    on_log: EmitLog | None,
    on_workflow: EmitWorkflow | None,
    graph: WorkflowGraph,
    openhands_sandbox: dict[str, Any] | None = None,
) -> PhaseOutcome:
    node_id = f"{phase.value}-c{cycle}"
    _emit_workflow(
        on_workflow,
        {
            "type": "workflow",
            "event": "phase_start",
            "phase": phase.value,
            "cycle": cycle,
            "node_id": node_id,
            "agent": role.display_name,
            "agent_record_id": role.agent_record_id,
            "role": role.role,
        },
    )
    _emit_log(on_log, f"── {role.display_name} · {phase.value} (cycle {cycle}) ──")

    graph.add_node(
        node_id,
        phase=phase.value,
        cycle=cycle,
        status="running",
        agent=role.display_name,
        role=role.role,
    )

    _, conversation, workspace = create_agent_and_conversation(
        repo_dir=repo_dir,
        api_key=api_key,
        skills=role.skills,
        openhands_settings=role.openhands_settings,
        mcp_servers=role.mcp_servers,
        system_instruction=role.system_instruction,
        on_log=on_log,
        openhands_sandbox=openhands_sandbox,
    )

    phase_path = repo_dir / PHASE_RESULT_FILE
    if phase_path.exists():
        phase_path.unlink()

    prompt = _phase_prompt(
        phase,
        goal=goal,
        base_branch=base_branch,
        feature_branch=feature_branch,
        cycle=cycle,
        feedback=feedback,
    )
    try:
        conversation.send_message(prompt)
        conversation.run()
    finally:
        try:
            conversation.close()
        except Exception:
            pass
        try:
            workspace.__exit__(None, None, None)
        except Exception:
            pass

    if phase == WorkflowPhase.DEPLOY:
        status, pr_url, summary = parse_result_file(repo_dir / ".openhands_result.json")
        # Deterministic fallback: the agent may push the branch but skip writing the
        # result file or opening the PR. If we still have no PR url, open/find it via gh.
        if not pr_url and _has_committed_changes(repo_dir, base_branch, feature_branch):
            fallback_url = _ensure_pull_request(repo_dir, base_branch, feature_branch, goal)
            if fallback_url:
                pr_url = fallback_url
                status = "finished"
                summary = summary or "Pull request opened by deploy fallback."
                _emit_log(on_log, f"Deploy fallback opened/located PR: {pr_url}")
        phase_status = "passed" if status == "finished" and pr_url else "failed"
        outcome = PhaseOutcome(
            phase=phase,
            cycle=cycle,
            status=phase_status,
            summary=summary or (f"PR: {pr_url}" if pr_url else None),
            feedback=None if phase_status == "passed" else summary,
            pr_url=pr_url,
        )
    else:
        phase_status, summary, feedback_text = parse_phase_result(phase_path)
        # Guard: a "passed" develop phase that produced no committed change vs base
        # is a false completion (e.g. agent claims the fix already exists). Force a
        # retry so the workflow does not finish without an actual diff/PR.
        if (
            phase == WorkflowPhase.DEVELOP
            and phase_status == "passed"
            and not _has_committed_changes(repo_dir, base_branch, feature_branch)
        ):
            phase_status = "failed"
            feedback_text = (
                "No committed changes were detected on the feature branch versus "
                f"`{base_branch}`. The goal requires an actual code change. Verify the "
                "current state in the repository (do not assume it is already done), "
                "make the required edit, and commit it to "
                f"`{feature_branch}`."
            )
            summary = summary or "No changes produced"
        outcome = PhaseOutcome(
            phase=phase,
            cycle=cycle,
            status=phase_status,
            summary=summary,
            feedback=feedback_text,
        )

    for node in graph.nodes:
        if node.get("id") == node_id:
            node["status"] = outcome.status
            node["summary"] = outcome.summary
            break

    _emit_workflow(
        on_workflow,
        {
            "type": "workflow",
            "event": "phase_end",
            "phase": phase.value,
            "cycle": cycle,
            "node_id": node_id,
            "status": outcome.status,
            "summary": outcome.summary,
            "feedback": outcome.feedback,
            "agent": role.display_name,
        },
    )
    _emit_log(
        on_log,
        f"── {phase.value} finished: {outcome.status}"
        + (f" — {outcome.summary}" if outcome.summary else ""),
    )
    return outcome


def run_implementation_workflow(
    *,
    repo_dir: Path,
    goal: str,
    base_branch: str,
    feature_branch: str,
    model: str,
    api_key: str,
    roles: dict[str, RoleAgentSpec],
    max_cycles: int = 3,
    pipeline_steps: list[str] | None = None,
    on_log: EmitLog | None = None,
    on_workflow: EmitWorkflow | None = None,
    openhands_sandbox: dict[str, Any] | None = None,
) -> tuple[RepoRunResult, WorkflowGraph]:
    graph = WorkflowGraph()
    ordered = list(pipeline_steps or ["develop", "review", "test", "deploy"])
    if not ordered or ordered[0] != "develop" or ordered[-1] != "deploy":
        ordered = ["develop", "review", "test", "deploy"]
    cycle_phase_keys = [p for p in ordered if p != "deploy"]
    deploy_key = "deploy" if "deploy" in ordered else None

    _emit_workflow(
        on_workflow,
        {
            "type": "workflow",
            "event": "run_start",
            "max_cycles": max_cycles,
            "roles": list(roles.keys()),
            "pipeline_steps": ordered,
        },
    )
    cycle_label = " → ".join(cycle_phase_keys) if cycle_phase_keys else "develop"
    _emit_log(
        on_log,
        f"Starting multi-agent workflow ({cycle_label}, max {max_cycles} cycles)",
    )

    deploy = roles[WorkflowPhase.DEPLOY.value] if deploy_key else None

    feedback: str | None = None
    prev_node_id: str | None = None
    approved = False

    for cycle in range(1, max_cycles + 1):
        _emit_workflow(
            on_workflow,
            {"type": "workflow", "event": "cycle_start", "cycle": cycle},
        )
        _emit_log(on_log, f"════ Cycle {cycle}/{max_cycles} ════")

        cycle_ok = True
        for phase_key in cycle_phase_keys:
            phase = WorkflowPhase(phase_key)
            role = roles[phase_key]
            outcome = run_phase(
                phase=phase,
                cycle=cycle,
                role=role,
                repo_dir=repo_dir,
                goal=goal,
                base_branch=base_branch,
                feature_branch=feature_branch,
                model=model,
                api_key=api_key,
                feedback=feedback if phase == WorkflowPhase.DEVELOP else None,
                on_log=on_log,
                on_workflow=on_workflow,
                graph=graph,
                openhands_sandbox=openhands_sandbox,
            )
            node_id = f"{phase.value}-c{cycle}"
            if prev_node_id:
                graph.add_edge(prev_node_id, node_id)
            prev_node_id = node_id

            if outcome.status != "passed":
                cycle_ok = False
                feedback = outcome.feedback or outcome.summary or f"{phase.value} did not pass"
                _emit_log(on_log, f"Cycle {cycle}: returning to develop — {feedback[:200]}")
                break

        if cycle_ok:
            approved = True
            _emit_workflow(
                on_workflow,
                {"type": "workflow", "event": "cycle_end", "cycle": cycle, "status": "passed"},
            )
            break

        _emit_workflow(
            on_workflow,
            {
                "type": "workflow",
                "event": "cycle_end",
                "cycle": cycle,
                "status": "failed",
                "feedback": feedback,
            },
        )

    if not approved:
        _emit_workflow(
            on_workflow,
            {
                "type": "workflow",
                "event": "run_end",
                "status": "failed",
                "graph": graph.to_dict(),
            },
        )
        return (
            RepoRunResult(
                repo="",
                status="failed",
                pr_url=None,
                summary=None,
                workspace=str(repo_dir.parent),
                error=feedback or "Implementation cycles did not pass",
            ),
            graph,
        )

    if not deploy or not deploy_key:
        _emit_workflow(
            on_workflow,
            {
                "type": "workflow",
                "event": "run_end",
                "status": "failed",
                "graph": graph.to_dict(),
            },
        )
        return (
            RepoRunResult(
                repo="",
                status="failed",
                pr_url=None,
                summary=None,
                workspace=str(repo_dir.parent),
                error="Deploy phase is not configured in the pipeline",
            ),
            graph,
        )

    deploy_outcome = run_phase(
        phase=WorkflowPhase.DEPLOY,
        cycle=0,
        role=deploy,
        repo_dir=repo_dir,
        goal=goal,
        base_branch=base_branch,
        feature_branch=feature_branch,
        model=model,
        api_key=api_key,
        feedback=None,
        on_log=on_log,
        on_workflow=on_workflow,
        graph=graph,
        openhands_sandbox=openhands_sandbox,
    )
    if prev_node_id:
        graph.add_edge(prev_node_id, "deploy-c0")

    status, pr_url, summary = parse_result_file(repo_dir / ".openhands_result.json")
    # Prefer the PR url resolved during the deploy phase (incl. the gh fallback),
    # since the agent may not have written .openhands_result.json.
    if not pr_url and deploy_outcome.pr_url:
        pr_url = deploy_outcome.pr_url
        summary = summary or deploy_outcome.summary
    finished = deploy_outcome.status == "passed" and pr_url is not None

    _emit_workflow(
        on_workflow,
        {
            "type": "workflow",
            "event": "run_end",
            "status": "finished" if finished else "failed",
            "graph": graph.to_dict(),
        },
    )

    return (
        RepoRunResult(
            repo="",
            status="finished" if finished else "failed",
            pr_url=pr_url,
            summary=summary or deploy_outcome.summary,
            workspace=str(repo_dir.parent),
            error=None if finished else (deploy_outcome.feedback or "Deploy phase failed"),
        ),
        graph,
    )
