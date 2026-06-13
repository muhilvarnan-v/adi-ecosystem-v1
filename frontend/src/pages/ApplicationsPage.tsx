import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createApplication,
  deleteApplication,
  listApplications,
  updateApplication,
} from '../api/applications';
import { PlusIcon, TrashIcon } from '../components/Icons';
import type {
  Application,
  WorkflowDefinition,
} from '../types';
import { listWorkflows } from '../api/workflows';
import { LoadingIndicator } from './applicationSharedUi';

const STANDARD_WORKFLOW_NAME = 'Standard workflow';

function isStandardWorkflow(workflow: WorkflowDefinition): boolean {
  return workflow.name.trim().toLowerCase() === STANDARD_WORKFLOW_NAME.toLowerCase();
}

export function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowDefinition[]>([]);
  const [modalDependenciesLoading, setModalDependenciesLoading] = useState(false);
  const [modalDependenciesLoaded, setModalDependenciesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAppModal, setShowAppModal] = useState(false);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [appTitle, setAppTitle] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [appSelfHealingWorkflowId, setAppSelfHealingWorkflowId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const appsData = await listApplications();
      setApplications(appsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModalDependencies = useCallback(async () => {
    if (modalDependenciesLoading || modalDependenciesLoaded) return;
    setModalDependenciesLoading(true);
    try {
      const wfRes = await listWorkflows().catch(() => ({ workflows: [] as WorkflowDefinition[], updated_at: null }));
      setWorkflowTemplates(wfRes.workflows ?? []);

      setModalDependenciesLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load application settings');
    } finally {
      setModalDependenciesLoading(false);
    }
  }, [modalDependenciesLoaded, modalDependenciesLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showAppModal) return;
    void loadModalDependencies();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAppModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [loadModalDependencies, showAppModal]);

  function closeAppModal() {
    setShowAppModal(false);
    setEditingApplicationId(null);
    setAppTitle('');
    setAppDescription('');
    setAppSelfHealingWorkflowId('');
  }

  function openEditApplication(app: Application) {
    setEditingApplicationId(app.id);
    setAppTitle(app.title);
    setAppDescription(app.description ?? '');
    setAppSelfHealingWorkflowId(app.self_healing_workflow_id ?? '');
    setShowAppModal(true);
  }

  async function handleAppSubmit(e: FormEvent) {
    e.preventDefault();
    if (!appTitle.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editingApplicationId) {
        const updated = await updateApplication(editingApplicationId, {
          title: appTitle.trim(),
          description: appDescription.trim(),
          self_healing_workflow_id: appSelfHealingWorkflowId || null,
        });
        setApplications((prev) => prev.map((a) => (a.id === editingApplicationId ? updated : a)));
      } else {
        const created = await createApplication(
          appTitle.trim(),
          appDescription.trim(),
          null,
          { self_healing_workflow_id: appSelfHealingWorkflowId || null },
        );
        setApplications((prev) => [created, ...prev]);
      }
      closeAppModal();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : editingApplicationId
            ? 'Failed to update application'
            : 'Failed to create application',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteApplication(id: string, title: string) {
    if (!confirm(`Delete "${title}" and all its goals?`)) return;
    try {
      await deleteApplication(id);
      setApplications((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete application');
    }
  }

  const automaticSelfHealingWorkflow =
    workflowTemplates.find(isStandardWorkflow) ??
    (workflowTemplates.length === 1 ? workflowTemplates[0] : null);

  const appModal = showAppModal && (
    <div className="modal-overlay" role="presentation" onClick={closeAppModal}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="app-modal-title">{editingApplicationId ? 'Edit application' : 'Create application'}</h2>
          <button type="button" className="modal-close" onClick={closeAppModal} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleAppSubmit} className="form">
          {modalDependenciesLoading && (
            <div className="applications-modal-loading">
              <LoadingIndicator />
              <p className="muted">Loading workflow options...</p>
            </div>
          )}
          <label>
            Title
            <input
              value={appTitle}
              onChange={(e) => setAppTitle(e.target.value)}
              required
              maxLength={500}
              placeholder="e.g. Customer portal"
              autoFocus
            />
          </label>
          <label>
            Description
            <textarea
              value={appDescription}
              onChange={(e) => setAppDescription(e.target.value)}
              rows={4}
              maxLength={10000}
              placeholder="What is this application about?"
            />
          </label>
          <fieldset className="fieldset app-self-healing-settings">
            <legend>Self-healing</legend>
            {workflowTemplates.length > 0 ? (
              <label>
                Auto-fix workflow
                <select
                  value={appSelfHealingWorkflowId}
                  onChange={(e) => setAppSelfHealingWorkflowId(e.target.value)}
                >
                  <option value="">
                    Automatic {automaticSelfHealingWorkflow ? `(${automaticSelfHealingWorkflow.name})` : ''}
                  </option>
                  {workflowTemplates.map((wf) => (
                    <option key={wf.id} value={wf.id}>
                      {wf.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted small">
                Create a workflow under <Link to="/workflows">Workflows</Link> before auto-fix can run.
              </p>
            )}
          </fieldset>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeAppModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || modalDependenciesLoading}>
              <PlusIcon />
              {submitting ? 'Saving…' : editingApplicationId ? 'Save changes' : 'Create application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  function repoLabel(url: string | null | undefined) {
    if (!url) return '—';
    return url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  }

  function updatedLabel(isoDate: string) {
    try {
      return new Date(isoDate).toLocaleDateString();
    } catch {
      return 'Recently';
    }
  }

  return (
    <div className="page page-applications">
      <div className="page-header page-header-row">
        <div>
          <h1>Applications</h1>
          <p className="muted">
            Your applications in a list. Open one to manage goals, imports, and self-healing.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowAppModal(true)}>
          <PlusIcon />
          Add application
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {appModal}

      {loading ? (
        <div className="empty-state">
          <LoadingIndicator />
        </div>
      ) : applications.length === 0 ? (
        <section className="card">
          <div className="empty-state">
            <p className="muted">No applications yet. Use Add application above to get started.</p>
          </div>
        </section>
      ) : (
        <div className="applications-overview">
          <section className="applications-grid" aria-label="Applications list">
            {applications.map((app) => (
              <article key={app.id} className="card applications-grid-card">
                <div className="applications-grid-card-head">
                  <Link to={`/applications/${app.id}`} className="applications-grid-card-title">
                    {app.title}
                  </Link>
                  <span className="applications-grid-card-updated">Updated {updatedLabel(app.updated_at)}</span>
                </div>
                <p className="applications-grid-card-desc muted">
                  {app.description?.trim() || 'No description yet.'}
                </p>
                <p className="applications-grid-card-repo muted">{repoLabel(app.github_repo_url)}</p>
                <div className="applications-grid-card-actions">
                  <Link to={`/applications/${app.id}`} className="btn btn-primary btn-sm">
                    Open application
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openEditApplication(app)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDeleteApplication(app.id, app.title)}
                  >
                    <TrashIcon />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
