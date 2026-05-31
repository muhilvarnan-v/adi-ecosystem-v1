import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createApplication,
  deleteApplication,
  listApplications,
  updateApplication,
} from '../api/applications';
import { listGoals } from '../api/goals';
import { listGitHubRepos, listIntegrations } from '../api/integrations';
import { listSelfHealingIncidents } from '../api/selfHealing';
import { PlusIcon, TrashIcon } from '../components/Icons';
import type {
  Application,
  GitHubRepo,
  Goal,
  IntegrationStatus,
  WorkflowDefinition,
} from '../types';
import { listWorkflows } from '../api/workflows';
import {
  APPLICATION_UNASSIGNED_SLUG,
  GitHubRepoField,
  LoadingIndicator,
} from './applicationSharedUi';

const STANDARD_WORKFLOW_NAME = 'Standard workflow';

function isStandardWorkflow(workflow: WorkflowDefinition): boolean {
  return workflow.name.trim().toLowerCase() === STANDARD_WORKFLOW_NAME.toLowerCase();
}

export function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [incidentCounts, setIncidentCounts] = useState<Record<string, number>>({});
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [reposLoadError, setReposLoadError] = useState<string | null>(null);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAppModal, setShowAppModal] = useState(false);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [appTitle, setAppTitle] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [appRepoUrl, setAppRepoUrl] = useState('');
  const [appSelfHealingWorkflowId, setAppSelfHealingWorkflowId] = useState('');

  const githubConnected = integrations.find((i) => i.provider === 'github')?.connected;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appsData, goalsData, integrationsData, wfRes] = await Promise.all([
        listApplications(),
        listGoals(),
        listIntegrations(),
        listWorkflows().catch(() => ({ workflows: [] as WorkflowDefinition[], updated_at: null })),
      ]);
      setApplications(appsData);
      setGoals(goalsData);
      setIntegrations(integrationsData);
      setWorkflowTemplates(wfRes.workflows ?? []);

      const githubOn = integrationsData.find((i) => i.provider === 'github')?.connected;
      if (githubOn) {
        try {
          setGithubRepos(await listGitHubRepos());
          setReposLoadError(null);
        } catch (e) {
          setGithubRepos([]);
          setReposLoadError(
            e instanceof Error ? e.message : 'Failed to load GitHub repositories',
          );
        }
      } else {
        setGithubRepos([]);
        setReposLoadError(null);
      }

      const incidentEntries = await Promise.all(
        appsData.map(async (app) => {
          try {
            const incidents = await listSelfHealingIncidents(app.id);
            return [app.id, incidents.length] as const;
          } catch {
            return [app.id, 0] as const;
          }
        }),
      );
      setIncidentCounts(Object.fromEntries(incidentEntries));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showAppModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAppModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showAppModal]);

  function closeAppModal() {
    setShowAppModal(false);
    setEditingApplicationId(null);
    setAppTitle('');
    setAppDescription('');
    setAppRepoUrl('');
    setAppSelfHealingWorkflowId('');
  }

  function openEditApplication(app: Application) {
    setEditingApplicationId(app.id);
    setAppTitle(app.title);
    setAppDescription(app.description ?? '');
    setAppRepoUrl(app.github_repo_url ?? '');
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
          github_repo_url: appRepoUrl || null,
          self_healing_workflow_id: appSelfHealingWorkflowId || null,
        });
        setApplications((prev) => prev.map((a) => (a.id === editingApplicationId ? updated : a)));
      } else {
        const created = await createApplication(
          appTitle.trim(),
          appDescription.trim(),
          appRepoUrl || null,
          { self_healing_workflow_id: appSelfHealingWorkflowId || null },
        );
        setApplications((prev) => [created, ...prev]);
        try {
          const incidents = await listSelfHealingIncidents(created.id);
          setIncidentCounts((prev) => ({ ...prev, [created.id]: incidents.length }));
        } catch {
          setIncidentCounts((prev) => ({ ...prev, [created.id]: 0 }));
        }
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
      setGoals((prev) => prev.filter((g) => g.application_id !== id));
      setIncidentCounts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete application');
    }
  }

  function goalCountForApp(applicationId: string) {
    return goals.filter((g) => g.application_id === applicationId).length;
  }

  const unassignedGoals = goals.filter((g) => !g.application_id);
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
          <GitHubRepoField
            repos={githubRepos}
            githubConnected={!!githubConnected}
            value={appRepoUrl}
            onChange={setAppRepoUrl}
            reposLoadError={reposLoadError}
          />
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
            <button type="submit" className="btn btn-primary" disabled={submitting}>
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
      {reposLoadError && !error && <div className="alert alert-error">{reposLoadError}</div>}
      {appModal}

      {loading ? (
        <div className="empty-state">
          <LoadingIndicator />
        </div>
      ) : applications.length === 0 && unassignedGoals.length === 0 ? (
        <section className="card">
          <div className="empty-state">
            <p className="muted">No applications yet. Use Add application above to get started.</p>
          </div>
        </section>
      ) : (
        <div className="applications-table-wrap card">
          <table className="applications-table">
            <thead>
              <tr>
                <th scope="col">Application</th>
                <th scope="col">Repository</th>
                <th scope="col" className="applications-table-numeric">
                  Goals
                </th>
                <th scope="col" className="applications-table-numeric">
                  Incidents
                </th>
                <th scope="col" className="applications-table-actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id}>
                  <td>
                    <div className="applications-table-title">
                      <Link to={`/applications/${app.id}`} className="applications-table-link">
                        {app.title}
                      </Link>
                      {app.description && (
                        <p className="applications-table-desc muted">{app.description}</p>
                      )}
                    </div>
                  </td>
                  <td className="applications-table-repo muted">{repoLabel(app.github_repo_url)}</td>
                  <td className="applications-table-numeric">{goalCountForApp(app.id)}</td>
                  <td className="applications-table-numeric">{incidentCounts[app.id] ?? 0}</td>
                  <td className="applications-table-actions">
                    <Link to={`/applications/${app.id}`} className="btn btn-primary btn-sm">
                      Open
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
                  </td>
                </tr>
              ))}
              {unassignedGoals.length > 0 && (
                <tr className="applications-table-row-unassigned">
                  <td>
                    <div className="applications-table-title">
                      <Link
                        to={`/applications/${APPLICATION_UNASSIGNED_SLUG}`}
                        className="applications-table-link"
                      >
                        Unassigned goals
                      </Link>
                      <p className="applications-table-desc muted">
                        Goals without an application. Open to triage on the board.
                      </p>
                    </div>
                  </td>
                  <td className="applications-table-repo muted">—</td>
                  <td className="applications-table-numeric">{unassignedGoals.length}</td>
                  <td className="applications-table-numeric">—</td>
                  <td className="applications-table-actions">
                    <Link
                      to={`/applications/${APPLICATION_UNASSIGNED_SLUG}`}
                      className="btn btn-primary btn-sm"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
