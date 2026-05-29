import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { listAgents } from '../api/agents';
import { listWorkspaces } from '../api/workspaces';
import { listWorkflows, saveWorkflows } from '../api/workflows';
import type { Agent, Environment, WorkflowDefinition, WorkflowRole, WorkflowRoles } from '../types';
import {
  DEFAULT_WORKFLOW_STEPS,
  buildStepsFromFlags,
  flagsFromSteps,
  normalizeWorkflowSteps,
} from '../lib/workflowSteps';
import { PlusIcon, TrashIcon } from '../components/Icons';

const PHASE_LABELS: Record<WorkflowRole, string> = {
  develop: 'Development',
  review: 'Review',
  test: 'Test validation',
  deploy: 'Deployment',
};

function newWorkflowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `wf-${Date.now()}`;
}

function emptyWorkflow(): WorkflowDefinition {
  return {
    id: newWorkflowId(),
    name: 'New workflow',
    steps: [...DEFAULT_WORKFLOW_STEPS],
    workflow_roles: {},
    workflow_max_cycles: 3,
    sandbox_environment_id: null,
  };
}

export function WorkflowsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sandboxes, setSandboxes] = useState<Environment[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragAgentId, setDragAgentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [wfRes, ag, sb] = await Promise.all([listWorkflows(), listAgents(), listWorkspaces()]);
        if (cancelled) return;
        const raw = wfRes.workflows ?? [];
        setWorkflows(
          raw.map((w: WorkflowDefinition) => ({
            ...w,
            steps: normalizeWorkflowSteps(w.steps),
            workflow_roles: { ...(w.workflow_roles ?? {}) },
            workflow_max_cycles: w.workflow_max_cycles ?? 3,
            sandbox_environment_id: w.sandbox_environment_id ?? null,
          })),
        );
        setAgents(ag);
        setSandboxes(sb);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load');
          setWorkflows([]);
          setAgents([]);
          setSandboxes([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await saveWorkflows(workflows);
      const raw = res.workflows ?? [];
      setWorkflows(
        raw.map((w: WorkflowDefinition) => ({
          ...w,
          steps: normalizeWorkflowSteps(w.steps),
          workflow_roles: { ...(w.workflow_roles ?? {}) },
          workflow_max_cycles: w.workflow_max_cycles ?? 3,
          sandbox_environment_id: w.sandbox_environment_id ?? null,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save workflows');
    } finally {
      setSaving(false);
    }
  }

  function updateWorkflowAt(index: number, patch: Partial<WorkflowDefinition>) {
    setWorkflows((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function removeWorkflow(index: number) {
    setWorkflows((prev) => prev.filter((_, i) => i !== index));
  }

  function setRoleForWorkflow(
    wfIndex: number,
    role: WorkflowRole,
    agentRecordId: string | undefined,
  ) {
    setWorkflows((prev) =>
      prev.map((w, i) => {
        if (i !== wfIndex) return w;
        const nextRoles: WorkflowRoles = { ...w.workflow_roles };
        if (agentRecordId) nextRoles[role] = agentRecordId;
        else delete nextRoles[role];
        return { ...w, workflow_roles: nextRoles };
      }),
    );
  }

  function onDragAgentStart(e: DragEvent, agentId: string) {
    setDragAgentId(agentId);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/agent-id', agentId);
  }

  function onDragAgentEnd() {
    setDragAgentId(null);
  }

  function onDropOnPhase(e: DragEvent, wfIndex: number, role: WorkflowRole) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/agent-id') || dragAgentId;
    if (id) setRoleForWorkflow(wfIndex, role, id);
    setDragAgentId(null);
  }

  return (
    <div className="page workflows-page">
      <header className="page-header">
        <div>
          <h1>Workflows</h1>
          <p className="muted">
            Reusable implementation pipelines for your account. Drag agents from the right onto each phase,
            attach an optional OpenHands sandbox environment, then pick a workflow when you{' '}
            <Link to="/">create a goal</Link> on an application. Configure sandboxes under{' '}
            <Link to="/harness/sandbox-envs">Harness → Sandbox envs</Link>.
          </p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="workflows-toolbar workflows-toolbar-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading}
          onClick={() => setWorkflows((prev) => [...prev, emptyWorkflow()])}
        >
          <PlusIcon />
          Add workflow
        </button>
        <button type="button" className="btn btn-primary" disabled={loading || saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save all workflows'}
        </button>
      </div>

      <div className="workflows-page-layout">
        <div className="workflows-main">
          {loading ? (
            <p className="muted">Loading workflows…</p>
          ) : (
            <div className="workflows-list">
              {workflows.length === 0 ? (
                <div className="workflows-empty card-surface">
                  <p>No saved workflows yet. Add one, assign agents, and save.</p>
                </div>
              ) : (
                workflows.map((wf, wi) => {
                  const { includeReview, includeTest } = flagsFromSteps(wf.steps);
                  const steps = wf.steps;
                  return (
                    <article key={wf.id} className="workflow-editor card-surface">
                      <div className="workflow-editor-header">
                        <label className="workflow-editor-name">
                          <span className="muted small">Name</span>
                          <input
                            value={wf.name}
                            onChange={(e) => updateWorkflowAt(wi, { name: e.target.value })}
                            maxLength={200}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm workflow-editor-remove"
                          onClick={() => removeWorkflow(wi)}
                          aria-label="Remove workflow"
                        >
                          <TrashIcon />
                        </button>
                      </div>

                      <div className="workflow-editor-toggles">
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={includeReview}
                            onChange={(e) =>
                              updateWorkflowAt(wi, {
                                steps: buildStepsFromFlags(e.target.checked, includeTest),
                              })
                            }
                          />
                          Include code review
                        </label>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={includeTest}
                            onChange={(e) =>
                              updateWorkflowAt(wi, {
                                steps: buildStepsFromFlags(includeReview, e.target.checked),
                              })
                            }
                          />
                          Include test validation
                        </label>
                      </div>

                      <label className="workflow-editor-cycles">
                        Max implementation cycles (develop → … before deploy)
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={wf.workflow_max_cycles}
                          onChange={(e) =>
                            updateWorkflowAt(wi, { workflow_max_cycles: Number(e.target.value) || 3 })
                          }
                        />
                      </label>

                      <label className="workflow-editor-sandbox">
                        Sandbox environment (optional)
                        <select
                          value={wf.sandbox_environment_id ?? ''}
                          onChange={(e) =>
                            updateWorkflowAt(wi, {
                              sandbox_environment_id: e.target.value.trim() || null,
                            })
                          }
                        >
                          <option value="">— None —</option>
                          {sandboxes.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.display_name} ({s.env_id})
                            </option>
                          ))}
                        </select>
                        <span className="field-hint muted small">
                          OpenHands Docker host port or remote runtime API from Harness.
                        </span>
                      </label>

                      <div className="workflow-drop-grid">
                        {steps.map((role) => (
                          <div key={role} className="workflow-phase-column">
                            <div className="workflow-phase-title">{PHASE_LABELS[role]}</div>
                            <div
                              className="workflow-drop-zone"
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => onDropOnPhase(e, wi, role)}
                            >
                              {wf.workflow_roles[role] ? (
                                <div className="workflow-drop-assigned">
                                  <span>
                                    {agents.find((x) => x.id === wf.workflow_roles[role])?.display_name ??
                                      wf.workflow_roles[role]}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setRoleForWorkflow(wi, role, undefined)}
                                  >
                                    Clear
                                  </button>
                                </div>
                              ) : (
                                <span className="muted small">Drop agent here</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="muted small workflow-editor-hint">
                        Development and Deployment agents are required when this workflow is used for a goal.
                      </p>
                    </article>
                  );
                })
              )}
            </div>
          )}
        </div>

        <aside className="workflows-agents-rail" aria-label="Agents to assign">
          <h3 className="workflows-section-title">Agents</h3>
          <p className="muted small">Drag onto a phase column on the left.</p>
          <div className="workflows-agent-chips">
            {agents.length === 0 ? (
              <p className="muted small">
                No agents yet. <Link to="/agents">Create agents</Link> first.
              </p>
            ) : (
              agents.map((a) => (
                <div
                  key={a.id}
                  className={`workflows-agent-chip${dragAgentId === a.id ? ' dragging' : ''}`}
                  draggable
                  onDragStart={(e) => onDragAgentStart(e, a.id)}
                  onDragEnd={onDragAgentEnd}
                >
                  <strong>{a.display_name}</strong>
                  <span className="muted small">{a.agent_id}</span>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
