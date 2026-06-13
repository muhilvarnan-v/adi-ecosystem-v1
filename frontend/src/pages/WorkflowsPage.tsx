import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAgents } from '../api/agents';
import { listWorkspaces } from '../api/workspaces';
import { listWorkflows, saveWorkflows } from '../api/workflows';
import { WorkflowEditorModal } from '../components/WorkflowEditorModal';
import { PlusIcon, TrashIcon } from '../components/Icons';
import type { Agent, Environment, WorkflowDefinition, WorkflowRole } from '../types';
import { normalizeWorkflowSteps } from '../lib/workflowSteps';

function newWorkflowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `wf-${Date.now()}`;
}

function emptyWorkflow(defaultSandboxId: string | null): WorkflowDefinition {
  return {
    id: newWorkflowId(),
    name: 'New workflow',
    steps: ['develop', 'review', 'test', 'deploy'],
    workflow_roles: {},
    workflow_max_cycles: 3,
    sandbox_environment_id: defaultSandboxId,
  };
}

function cloneWorkflow(w: WorkflowDefinition): WorkflowDefinition {
  return {
    ...w,
    steps: [...normalizeWorkflowSteps(w.steps)],
    workflow_roles: { ...w.workflow_roles },
  };
}

type ModalState =
  | { type: 'closed' }
  | { type: 'create'; draft: WorkflowDefinition }
  | { type: 'edit'; index: number; draft: WorkflowDefinition };

function phaseSummary(steps: WorkflowRole[]): string {
  const has = (r: WorkflowRole) => steps.includes(r);
  const parts: string[] = ['Dev'];
  if (has('review')) parts.push('Review');
  if (has('test')) parts.push('Test');
  parts.push('Deploy');
  return parts.join(' → ');
}

function normalizeWorkflowRow(w: WorkflowDefinition): WorkflowDefinition {
  return {
    ...w,
    steps: normalizeWorkflowSteps(w.steps),
    workflow_roles: { ...(w.workflow_roles ?? {}) },
    workflow_max_cycles: w.workflow_max_cycles ?? 3,
    sandbox_environment_id: w.sandbox_environment_id ?? null,
  };
}

export function WorkflowsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sandboxes, setSandboxes] = useState<Environment[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'closed' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [wfRes, agRes, sbRes] = await Promise.allSettled([
          listWorkflows(),
          listAgents(),
          listWorkspaces(),
        ]);
        if (cancelled) return;
        if (wfRes.status === 'fulfilled') {
          const raw = wfRes.value.workflows ?? [];
          setWorkflows(raw.map((w: WorkflowDefinition) => normalizeWorkflowRow(w)));
        } else {
          setWorkflows([]);
          setError(wfRes.reason instanceof Error ? wfRes.reason.message : 'Failed to load workflows');
        }

        if (agRes.status === 'fulfilled') {
          setAgents(agRes.value);
        } else {
          setAgents([]);
        }

        if (sbRes.status === 'fulfilled') {
          setSandboxes(sbRes.value);
        } else {
          setSandboxes([]);
        }
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

  async function persistWorkflows(nextWorkflows: WorkflowDefinition[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await saveWorkflows(nextWorkflows);
      const raw = res.workflows ?? [];
      setWorkflows(raw.map((w: WorkflowDefinition) => normalizeWorkflowRow(w)));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save workflows');
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setModal({ type: 'create', draft: emptyWorkflow(sandboxes[0]?.id ?? null) });
  }

  function openEdit(index: number) {
    const w = workflows[index];
    if (!w) return;
    setModal({ type: 'edit', index, draft: cloneWorkflow(w) });
  }

  function closeModal() {
    setModal({ type: 'closed' });
  }

  async function confirmModal() {
    if (modal.type === 'closed') return;
    const nextWorkflows =
      modal.type === 'create'
        ? [...workflows, normalizeWorkflowRow(modal.draft)]
        : workflows.map((w, i) => (i === modal.index ? normalizeWorkflowRow(modal.draft) : w));
    const saved = await persistWorkflows(nextWorkflows);
    if (saved) setModal({ type: 'closed' });
  }

  async function removeWorkflowAt(index: number) {
    const nextWorkflows = workflows.filter((_, i) => i !== index);
    const saved = await persistWorkflows(nextWorkflows);
    if (!saved) return;
    setModal((m) => {
      if (m.type === 'closed' || m.type === 'create') return m;
      if (m.index === index) return { type: 'closed' };
      if (m.index > index) return { type: 'edit', index: m.index - 1, draft: m.draft };
      return m;
    });
  }

  function updateModalDraft(next: WorkflowDefinition) {
    setModal((m) => {
      if (m.type === 'closed') return m;
      if (m.type === 'create') return { type: 'create', draft: next };
      return { type: 'edit', index: m.index, draft: next };
    });
  }

  const modalEl =
    modal.type !== 'closed' ? (
      <WorkflowEditorModal
        mode={modal.type === 'create' ? 'create' : 'edit'}
        draft={modal.draft}
        onChange={updateModalDraft}
        agents={agents}
        sandboxes={sandboxes}
        onClose={closeModal}
        onConfirm={confirmModal}
        onDelete={modal.type === 'edit' ? () => void removeWorkflowAt(modal.index) : undefined}
      />
    ) : null;

  return (
    <div className="page workflows-page">
      <header className="page-header">
        <div>
          <h1>Workflows</h1>
          <p className="muted">
            Reusable implementation pipelines. Open a workflow to configure phases and drag agents onto each step. Pick
            a workflow when you <Link to="/">create a goal</Link> on an application.
          </p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="workflows-toolbar workflows-toolbar-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={openCreate}>
          <PlusIcon />
          Add workflow
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading workflows…</p>
      ) : workflows.length === 0 ? (
        <div className="workflows-empty card-surface workflows-list-minimal-empty">
          <p>No saved workflows yet.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            Add workflow
          </button>
        </div>
      ) : (
        <ul className="workflows-list-minimal" aria-label="Workflows">
          {workflows.map((wf, i) => {
            const steps = normalizeWorkflowSteps(wf.steps);
            const sb = wf.sandbox_environment_id
              ? sandboxes.find((s) => s.id === wf.sandbox_environment_id)
              : null;
            return (
              <li key={wf.id} className="workflows-list-minimal-row card-surface">
                <div className="workflows-list-minimal-main">
                  <span className="workflows-list-minimal-name">{wf.name || 'Untitled'}</span>
                  <span className="workflows-list-minimal-meta muted small">{phaseSummary(steps)}</span>
                  {sb && (
                    <span className="workflows-list-minimal-sandbox muted small" title={sb.env_id}>
                      Sandbox: {sb.display_name}
                    </span>
                  )}
                </div>
                <div className="workflows-list-minimal-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(i)}>
                    View / edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm workflows-list-minimal-trash"
                    onClick={() => void removeWorkflowAt(i)}
                    aria-label={`Remove ${wf.name || 'workflow'}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {modalEl}
    </div>
  );
}
