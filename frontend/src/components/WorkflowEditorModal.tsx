import type { CSSProperties, DragEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent, Environment, WorkflowDefinition, WorkflowRole, WorkflowRoles } from '../types';
import { buildStepsFromFlags, flagsFromSteps } from '../lib/workflowSteps';

const PHASE_LABELS: Record<WorkflowRole, string> = {
  develop: 'Development',
  review: 'Review',
  test: 'Test validation',
  deploy: 'Deployment',
};

const PHASE_COLORS: Record<WorkflowRole, string> = {
  develop: '#3a6679',
  review: '#007faa',
  test: '#cb8509',
  deploy: '#6b9e78',
};

const PIPELINE_DISPLAY_ORDER: WorkflowRole[] = ['develop', 'review', 'test', 'deploy'];

export type WorkflowEditorModalProps = {
  mode: 'create' | 'edit';
  draft: WorkflowDefinition;
  onChange: (next: WorkflowDefinition) => void;
  agents: Agent[];
  sandboxes: Environment[];
  onClose: () => void;
  onConfirm: () => void;
  onDelete?: () => void;
};

export function WorkflowEditorModal({
  mode,
  draft,
  onChange,
  agents,
  sandboxes,
  onClose,
  onConfirm,
  onDelete,
}: WorkflowEditorModalProps) {
  const [dragAgentId, setDragAgentId] = useState<string | null>(null);
  const hasSandboxes = sandboxes.length > 0;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (draft.sandbox_environment_id || sandboxes.length === 0) return;
    onChange({ ...draft, sandbox_environment_id: sandboxes[0].id });
  }, [draft, onChange, sandboxes]);

  const { includeReview, includeTest } = flagsFromSteps(draft.steps);

  function patch(p: Partial<WorkflowDefinition>) {
    onChange({ ...draft, ...p });
  }

  function setRole(role: WorkflowRole, agentRecordId: string | undefined) {
    const nextRoles: WorkflowRoles = { ...draft.workflow_roles };
    if (agentRecordId) nextRoles[role] = agentRecordId;
    else delete nextRoles[role];
    patch({ workflow_roles: nextRoles });
  }

  function applyOptionalToggle(role: WorkflowRole, enabled: boolean) {
    if (role === 'review') {
      const nextSteps = buildStepsFromFlags(enabled, includeTest);
      const nextRoles = { ...draft.workflow_roles };
      if (!enabled) delete nextRoles.review;
      onChange({ ...draft, steps: nextSteps, workflow_roles: nextRoles });
      return;
    }
    if (role === 'test') {
      const nextSteps = buildStepsFromFlags(includeReview, enabled);
      const nextRoles = { ...draft.workflow_roles };
      if (!enabled) delete nextRoles.test;
      onChange({ ...draft, steps: nextSteps, workflow_roles: nextRoles });
    }
  }

  function onDragAgentStart(e: DragEvent, agentId: string) {
    setDragAgentId(agentId);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/agent-id', agentId);
  }

  function onDragAgentEnd() {
    setDragAgentId(null);
  }

  function onDropOnPhase(e: DragEvent, role: WorkflowRole) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/agent-id') || dragAgentId;
    if (id) setRole(role, id);
    setDragAgentId(null);
  }

  const titleId = 'workflow-editor-modal-title';

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal workflow-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header workflow-editor-modal-header">
          <div>
            <h2 id={titleId}>{mode === 'create' ? 'New workflow' : 'Workflow'}</h2>
            <label className="workflow-modal-name-label">
              <span className="muted small">Name</span>
              <input
                className="workflow-modal-name-input"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={200}
                autoFocus={mode === 'create'}
              />
            </label>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="workflow-editor-modal-body">
          <div className="workflow-editor-modal-main">
            <section className="workflow-pipeline-section" aria-label="Pipeline">
              <h3 className="workflow-modal-section-heading">Pipeline</h3>
              <p className="muted small workflow-pipeline-lead">
                Turn optional phases on or off. Drag agents from the right onto each active phase (scroll the pipeline
                row if it is clipped).
              </p>
              <div className="workflow-pipeline-graph" role="group" aria-label="Workflow phases in order">
                {PIPELINE_DISPLAY_ORDER.map((role, idx) => {
                  const color = PHASE_COLORS[role];
                  const isOptional = role === 'review' || role === 'test';
                  const enabled = isOptional ? (role === 'review' ? includeReview : includeTest) : true;

                  return (
                    <div key={role} className="workflow-pipeline-lane">
                      {idx > 0 && (
                        <div className="workflow-pipeline-connector" aria-hidden>
                          <span className="workflow-pipeline-connector-line" />
                        </div>
                      )}
                      <div
                        className={`workflow-pipeline-node${!enabled ? ' workflow-pipeline-node-off' : ''}`}
                        style={{ '--phase-color': color } as CSSProperties}
                      >
                        <div className="workflow-pipeline-node-glow" />
                        <div className="workflow-pipeline-node-head">
                          <span className="workflow-pipeline-node-phase" style={{ borderColor: color, color }}>
                            {PHASE_LABELS[role]}
                          </span>
                          {isOptional && (
                            <label className="workflow-pipeline-node-toggle">
                              <input
                                type="checkbox"
                                checked={enabled}
                                aria-label={`Include ${PHASE_LABELS[role]} phase in pipeline`}
                                onChange={(e) => applyOptionalToggle(role, e.target.checked)}
                              />
                            </label>
                          )}
                        </div>
                        <div
                          className={`workflow-pipeline-drop${!enabled ? ' workflow-pipeline-drop-disabled' : ''}`}
                          onDragOver={(e) => enabled && e.preventDefault()}
                          onDrop={(e) => enabled && onDropOnPhase(e, role)}
                        >
                          {!enabled ? (
                            <span className="muted small">Phase off</span>
                          ) : draft.workflow_roles[role] ? (
                            <div className="workflow-pipeline-assigned">
                              <span>
                                {agents.find((x) => x.id === draft.workflow_roles[role])?.display_name ??
                                  draft.workflow_roles[role]}
                              </span>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setRole(role, undefined)}
                              >
                                Clear
                              </button>
                            </div>
                          ) : (
                            <span className="muted small">Drop agent</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="workflow-modal-meta-grid">
              <label className="workflow-editor-cycles">
                Max implementation cycles
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.workflow_max_cycles}
                  onChange={(e) => patch({ workflow_max_cycles: Number(e.target.value) || 3 })}
                />
              </label>
              <label className="workflow-editor-sandbox">
                Sandbox environment
                {hasSandboxes ? (
                  <select
                    required
                    value={draft.sandbox_environment_id ?? sandboxes[0].id}
                    onChange={(e) => patch({ sandbox_environment_id: e.target.value.trim() || null })}
                  >
                    {sandboxes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.display_name} ({s.env_id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="muted small">
                    No sandbox environments found. Create one in <Link to="/harness/sandbox-envs">Harness → Sandbox
                    envs</Link> to save this workflow.
                  </p>
                )}
              </label>
            </div>
            <p className="muted small workflow-editor-hint">
              Development and Deployment agents are required when this workflow is used for a goal. Configure sandboxes
              under <Link to="/harness/sandbox-envs">Harness → Sandbox envs</Link>.
            </p>
          </div>

          <aside className="workflow-editor-modal-agents" aria-label="Agents to assign">
            <h3 className="workflow-modal-section-heading">Agents</h3>
            <p className="muted small">Drag onto a phase above.</p>
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

        <div className="modal-actions workflow-editor-modal-actions">
          {mode === 'edit' && onDelete && (
            <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
              Remove workflow
            </button>
          )}
          <span className="workflow-modal-actions-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onConfirm()}
            disabled={!hasSandboxes || !draft.sandbox_environment_id}
          >
            {mode === 'create' ? 'Add workflow' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
