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

function emptyWorkflow(): WorkflowDefinition {
  return {
    id: newWorkflowId(),
    name: 'New workflow',
    steps: ['develop', 'review', 'test', 'deploy'],
    workflow_roles: {},
    workflow_max_cycles: 3,
    sandbox_environment_id: null,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: 'closed' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [wfRes, ag, sb] = await Promise.all([listWorkflows(), listAgents(), listWorkspaces()]);
        if (cancelled) return;
        const raw = wfRes.workflows ?? [];
        setWorkflows(raw.map((w: WorkflowDefinition) => normalizeWorkflowRow(w)));
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
      setWorkflows(raw.map((w: WorkflowDefinition) => normalizeWorkflowRow(w)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save workflows');
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setModal({ type: 'create', draft: emptyWorkflow() });
  }

  function openEdit(index: number) {
    const w = workflows[index];
    if (!w) return;
    setModal({ type: 'edit', index, draft: cloneWorkflow(w) });
  }

  function closeModal() {
    setModal({ type: 'closed' });
  }

  function confirmModal() {
    if (modal.type === 'closed') return;
    if (modal.type === 'create') {
      setWorkflows((prev) => [...prev, normalizeWorkflowRow(modal.draft)]);
    } else {
      const { index, draft } = modal;
      setWorkflows((prev) => prev.map((w, i) => (i === index ? normalizeWorkflowRow(draft) : w)));
    }
    setModal({ type: 'closed' });
  }

  function removeWorkflowAt(index: number) {
    setWorkflows((prev) => prev.filter((_, i) => i !== index));
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
        onDelete={modal.type === 'edit' ? () => removeWorkflowAt(modal.index) : undefined}
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
        <button type="button" className="btn btn-primary" disabled={loading || saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save all workflows'}
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
                    onClick={() => removeWorkflowAt(i)}
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
