import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createApplication,
  deleteApplication,
  listApplications,
  updateApplication,
} from '../api/applications';
import {
  createGoal,
  createGoalFromJira,
  createGoalFromTrello,
  createGoalFromWiz,
  createGoalFromZendesk,
  deleteGoal,
  listGoals,
  resumeGoal,
  updateGoal,
} from '../api/goals';
import {
  effectiveGoalWorkflowRoles,
} from '../components/GoalWorkflowAgentPicker';
import {
  listGitHubRepos,
  listIntegrations,
  listJiraIssues,
  listJiraSpaces,
  listTrelloCards,
  listZendeskTickets,
} from '../api/integrations';
import {
  listSelfHealingCiFailures,
  listSelfHealingIncidents,
  listSelfHealingSecurityIssues,
  listSelfHealingSlaBreaches,
} from '../api/selfHealing';
import { ExternalLinkIcon, GitHubIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type {
  Application,
  CloudInfrastructureItem,
  WorkflowDefinition,
  WorkflowRoles,
  ExternalCard,
  ExternalIssue,
  GitHubRepo,
  JiraSpace,
  Goal,
  GoalStatus,
  IntegrationStatus,
  SelfHealingIncident,
  WorkflowRole,
} from '../types';
import { listWorkflows } from '../api/workflows';
import {
  APPLICATION_UNASSIGNED_SLUG,
  goalExecutionPath,
  LoadingIndicator,
  repoUrlFor,
} from './applicationSharedUi';

const KANBAN_LANES: { id: GoalStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

type ApplicationViewTab = 'delivery_goals' | 'self_healing' | 'infrastructure';
type SelfHealingViewTab = 'incidents' | 'ci_cd' | 'sla_breach' | 'security';

const STANDARD_WORKFLOW_NAME = 'Standard workflow';

function isStandardWorkflow(workflow: WorkflowDefinition): boolean {
  return workflow.name.trim().toLowerCase() === STANDARD_WORKFLOW_NAME.toLowerCase();
}

function resolveSelfHealingWorkflow(
  application: Application,
  workflowTemplates: WorkflowDefinition[],
): WorkflowDefinition | undefined {
  if (application.self_healing_workflow_id) {
    return workflowTemplates.find((w) => w.id === application.self_healing_workflow_id);
  }
  return workflowTemplates.find(isStandardWorkflow) ?? (
    workflowTemplates.length === 1 ? workflowTemplates[0] : undefined
  );
}

function ApplicationRepoBar({
  app,
  githubConnected,
  githubRepos,
  saving,
  onRepoChange,
}: {
  app: Application;
  githubConnected: boolean;
  githubRepos: GitHubRepo[];
  saving: boolean;
  onRepoChange: (url: string) => void;
}) {
  const repoLabel = app.github_repo_url
    ? app.github_repo_url.replace(/^https?:\/\/github\.com\//, '')
    : null;

  if (!githubConnected) {
    return (
      <div className="application-repo-bar application-repo-bar-muted">
        <GitHubIcon />
        {repoLabel ? (
          <a
            href={app.github_repo_url!}
            target="_blank"
            rel="noreferrer"
            className="application-repo-name"
          >
            {repoLabel}
          </a>
        ) : (
          <span className="application-repo-placeholder">No repository linked</span>
        )}
        <span className="application-repo-hint">
          <Link to="/harness/integrations">Connect GitHub</Link>
        </span>
      </div>
    );
  }

  const linkedUrl = app.github_repo_url ?? '';
  const linkedInList = linkedUrl && githubRepos.some((r) => repoUrlFor(r) === linkedUrl);

  return (
    <div className="application-repo-bar">
      <GitHubIcon />
      <select
        className="application-repo-select-input"
        aria-label={`GitHub repository for ${app.title}`}
        value={linkedUrl}
        disabled={saving}
        onChange={(e) => onRepoChange(e.target.value)}
      >
        <option value="">No repository linked</option>
        {linkedUrl && repoLabel && !linkedInList && (
          <option value={linkedUrl}>{repoLabel} (linked)</option>
        )}
        {githubRepos.map((repo) => (
          <option key={repo.id} value={repoUrlFor(repo)}>
            {repo.full_name}
            {repo.private ? ' (private)' : ''}
          </option>
        ))}
      </select>
      {app.github_repo_url && (
        <a
          href={app.github_repo_url}
          target="_blank"
          rel="noreferrer"
          className="application-repo-open"
          aria-label="Open repository on GitHub"
          title="Open on GitHub"
        >
          <ExternalLinkIcon />
        </a>
      )}
    </div>
  );
}

type CloudInfrastructureDraftItem = CloudInfrastructureItem & { draft_id: string };

function createCloudInfrastructureDraft(item?: Partial<CloudInfrastructureItem>): CloudInfrastructureDraftItem {
  return {
    draft_id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    env_type: item?.env_type ?? 'dev',
    provider_type: item?.provider_type ?? 'aws',
    cloud_infra_id: item?.cloud_infra_id ?? '',
  };
}

function toCloudInfrastructureDraftItems(items: CloudInfrastructureItem[] | null | undefined): CloudInfrastructureDraftItem[] {
  const rows = (items ?? []).map((item) => createCloudInfrastructureDraft(item));
  return rows.length > 0 ? rows : [createCloudInfrastructureDraft()];
}

function InfrastructureSection({
  app,
  githubConnected,
  githubRepos,
  reposLoadError,
  saving,
  savingCloudInfrastructure,
  onRepoChange,
  onSaveCloudInfrastructure,
}: {
  app: Application;
  githubConnected: boolean;
  githubRepos: GitHubRepo[];
  reposLoadError: string | null;
  saving: boolean;
  savingCloudInfrastructure: boolean;
  onRepoChange: (url: string) => void;
  onSaveCloudInfrastructure: (items: CloudInfrastructureItem[]) => Promise<void>;
}) {
  const [cloudInfrastructureDraft, setCloudInfrastructureDraft] = useState<CloudInfrastructureDraftItem[]>(() =>
    toCloudInfrastructureDraftItems(app.cloud_infrastructure),
  );
  const [cloudInfrastructureError, setCloudInfrastructureError] = useState<string | null>(null);

  function updateCloudInfraDraft(draftId: string, updates: Partial<CloudInfrastructureItem>) {
    setCloudInfrastructureDraft((prev) =>
      prev.map((row) => (row.draft_id === draftId ? { ...row, ...updates } : row)),
    );
  }

  function addCloudInfraDraft() {
    setCloudInfrastructureDraft((prev) => [...prev, createCloudInfrastructureDraft()]);
  }

  function removeCloudInfraDraft(draftId: string) {
    setCloudInfrastructureDraft((prev) => {
      const next = prev.filter((row) => row.draft_id !== draftId);
      return next.length > 0 ? next : [createCloudInfrastructureDraft()];
    });
  }

  async function handleSaveCloudInfrastructure() {
    setCloudInfrastructureError(null);
    const payload = cloudInfrastructureDraft
      .map((row) => ({
        env_type: row.env_type,
        provider_type: row.provider_type,
        cloud_infra_id: row.cloud_infra_id.trim(),
      }))
      .filter((row) => row.cloud_infra_id.length > 0);

    try {
      await onSaveCloudInfrastructure(payload);
    } catch (e) {
      setCloudInfrastructureError(
        e instanceof Error ? e.message : 'Failed to save cloud infrastructure',
      );
    }
  }

  const configuredCloudInfrastructureCount = (app.cloud_infrastructure ?? []).length;

  return (
    <div className="infrastructure-section">
      <section className="card infrastructure-hero">
        <div className="card-header card-header-actions infrastructure-hero-header">
          <div className="card-header-title">
            <h2>Code Repo</h2>
            <span className="card-count">Single repo</span>
          </div>
        </div>
        <p className="muted infrastructure-hero-copy">
          Manage repository wiring now, with future direction toward multi-cloud infrastructure across environments.
        </p>
        {reposLoadError && <div className="alert alert-error">{reposLoadError}</div>}
        <ApplicationRepoBar
          app={app}
          githubConnected={githubConnected}
          githubRepos={githubRepos}
          saving={saving}
          onRepoChange={onRepoChange}
        />
      </section>

      <section className="card infrastructure-cloud-card" aria-label="Cloud infrastructure">
        <div className="card-header card-header-actions infrastructure-cloud-header">
          <div className="card-header-title">
            <h3>Cloud Infrastructure</h3>
            <span className="card-count">{configuredCloudInfrastructureCount} configured</span>
          </div>
        </div>
        <p className="muted small infrastructure-cloud-copy">
          Future: multi-cloud routing with explicit environment targets.
        </p>
        {cloudInfrastructureError && <div className="alert alert-error">{cloudInfrastructureError}</div>}

        <div className="infrastructure-cloud-list">
          {cloudInfrastructureDraft.map((item) => (
            <div key={item.draft_id} className="infrastructure-cloud-row">
              <label>
                ENV type
                <select
                  value={item.env_type}
                  disabled={savingCloudInfrastructure}
                  onChange={(e) =>
                    updateCloudInfraDraft(item.draft_id, {
                      env_type: e.target.value as CloudInfrastructureItem['env_type'],
                    })
                  }
                >
                  <option value="dev">dev</option>
                  <option value="uat">uat</option>
                  <option value="prod">prod</option>
                </select>
              </label>

              <label>
                Provider type
                <select
                  value={item.provider_type}
                  disabled={savingCloudInfrastructure}
                  onChange={(e) =>
                    updateCloudInfraDraft(item.draft_id, {
                      provider_type: e.target.value as CloudInfrastructureItem['provider_type'],
                    })
                  }
                >
                  <option value="aws">aws</option>
                  <option value="gcp">gcp</option>
                  <option value="azure">azure</option>
                </select>
              </label>

              <label>
                Cloud infra ID
                <input
                  type="text"
                  placeholder="infra-001"
                  value={item.cloud_infra_id}
                  disabled={savingCloudInfrastructure}
                  onChange={(e) =>
                    updateCloudInfraDraft(item.draft_id, {
                      cloud_infra_id: e.target.value,
                    })
                  }
                />
              </label>

              <button
                type="button"
                className="btn btn-danger btn-sm infrastructure-cloud-remove"
                disabled={savingCloudInfrastructure}
                onClick={() => removeCloudInfraDraft(item.draft_id)}
              >
                <TrashIcon />
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="infrastructure-cloud-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={savingCloudInfrastructure}
            onClick={addCloudInfraDraft}
          >
            <PlusIcon />
            Add cloud infra
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={savingCloudInfrastructure}
            onClick={() => {
              void handleSaveCloudInfrastructure();
            }}
          >
            Save cloud infra
          </button>
        </div>
      </section>
    </div>
  );
}

function GoalCard({
  goal,
  onDelete,
  viewTo,
  onResume,
  onDragStart,
  onDragEnd,
}: {
  goal: Goal;
  onDelete: (id: string) => void;
  viewTo: string;
  onResume?: (goal: Goal) => void;
  onDragStart: (e: DragEvent, goalId: string) => void;
  onDragEnd: () => void;
}) {
  function sourceLabel(source: Goal['source']) {
    if (source === 'jira') return 'Jira';
    if (source === 'trello') return 'Trello';
    if (source === 'zendesk') return 'Zendesk';
    if (source === 'circleci') return 'CircleCI';
    if (source === 'sla') return 'SLA';
    return 'Manual';
  }

  return (
    <article
      className="kanban-card"
      draggable
      onDragStart={(e) => onDragStart(e, goal.id)}
      onDragEnd={onDragEnd}
    >
      <div className="kanban-card-header">
        <h3>{goal.title}</h3>
        <div className="kanban-card-header-end">
          <span className={`badge badge-${goal.source}`}>{sourceLabel(goal.source)}</span>
        </div>
      </div>
      {goal.description && <p className="kanban-card-desc">{goal.description}</p>}
      {goal.pr_url && (
        <p className="kanban-card-pr">
          <a href={goal.pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Pull request
          </a>
        </p>
      )}
      {goal.execution_error && (
        <p className="kanban-card-error muted small">{goal.execution_error}</p>
      )}
      <div className="kanban-card-meta">
        <span>{new Date(goal.created_at).toLocaleDateString()}</span>
        {goal.external_url && (
          <a href={goal.external_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            <ExternalLinkIcon />
            Source
          </a>
        )}
      </div>
      <div className="kanban-card-actions">
        <Link
          to={viewTo}
          className="btn btn-secondary btn-sm"
          onClick={(e) => e.stopPropagation()}
        >
          View
        </Link>
        {onResume && goal.resumable && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onResume(goal);
            }}
          >
            Resume
          </button>
        )}
        <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(goal.id)}>
          <TrashIcon />
          Delete
        </button>
      </div>
    </article>
  );
}

function JiraImportPanel({
  issues,
  spaces,
  loadError,
  submitting,
  importDisabled = false,
  onImport,
  emptyMessage = 'No Jira issues found in the last year.',
  searchPlaceholder = 'Search by key, title, or space…',
  resolveImportId,
}: {
  issues: ExternalIssue[];
  spaces: JiraSpace[];
  loadError: string | null;
  submitting: boolean;
  importDisabled?: boolean;
  onImport: (issueKey: string) => void;
  emptyMessage?: string;
  searchPlaceholder?: string;
  resolveImportId?: (issue: ExternalIssue) => string;
}) {
  const [spaceFilter, setSpaceFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const spaceOptions = useMemo(() => {
    if (spaces.length > 0) {
      return [...spaces].sort((a, b) => a.name.localeCompare(b.name));
    }
    const byKey = new Map<string, JiraSpace>();
    for (const issue of issues) {
      if (issue.space_key && !byKey.has(issue.space_key)) {
        byKey.set(issue.space_key, {
          id: issue.space_key,
          key: issue.space_key,
          name: issue.space_name ?? issue.space_key,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [spaces, issues]);

  const filteredIssues = useMemo(() => {
    let list = issues;
    if (spaceFilter) {
      list = list.filter((issue) => issue.space_key === spaceFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (issue) =>
          issue.key?.toLowerCase().includes(q) ||
          issue.title.toLowerCase().includes(q) ||
          issue.description.toLowerCase().includes(q) ||
          issue.space_name?.toLowerCase().includes(q) ||
          issue.space_key?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [issues, spaceFilter, searchQuery]);

  if (loadError) {
    return <p className="alert alert-error">{loadError}</p>;
  }

  if (issues.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }

  function importIdFor(issue: ExternalIssue): string {
    if (resolveImportId) return resolveImportId(issue);
    return issue.key ?? issue.id;
  }

  return (
    <>
      <div className="import-toolbar">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search issues"
        />
        <select
          value={spaceFilter}
          onChange={(e) => setSpaceFilter(e.target.value)}
          aria-label="Filter by space"
        >
          <option value="">All spaces</option>
          {spaceOptions.map((space) => (
            <option key={space.key} value={space.key}>
              {space.name}
            </option>
          ))}
        </select>
      </div>
      <p className="import-meta muted">
        {filteredIssues.length} of {issues.length} issue{issues.length === 1 ? '' : 's'}
        {spaceFilter || searchQuery.trim() ? ' matching filters' : ''}
      </p>
      {filteredIssues.length === 0 ? (
        <p className="muted">No issues match your filters.</p>
      ) : (
        <div className="import-list">
          {filteredIssues.map((issue) => (
            <div key={issue.id} className="import-item">
              <div className="import-item-content">
                <strong>{issue.key}</strong> — {issue.title}
                {issue.space_name && (
                  <span className="badge badge-manual"> {issue.space_name}</span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={submitting || importDisabled}
                onClick={() => {
                  const id = importIdFor(issue);
                  if (id) onImport(id);
                }}
              >
                <PlusIcon />
                Import
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SelfHealingSection({
  application,
  incidents,
  ciIncidents,
  slaIncidents,
  securityIssues,
  goals,
  loadError,
  ciLoadError,
  slaLoadError,
  securityLoadError,
  integrations,
  workflowTemplates,
  saving,
  autoFixingIncidentId,
  onSettingsChange,
  onAutoFix,
}: {
  application: Application;
  incidents: SelfHealingIncident[];
  ciIncidents: SelfHealingIncident[];
  slaIncidents: SelfHealingIncident[];
  securityIssues: SelfHealingIncident[];
  goals: Goal[];
  loadError: string | null;
  ciLoadError: string | null;
  slaLoadError: string | null;
  securityLoadError: string | null;
  integrations: IntegrationStatus[];
  workflowTemplates: WorkflowDefinition[];
  saving: boolean;
  autoFixingIncidentId: string | null;
  onSettingsChange: (
    applicationId: string,
    updates: {
      self_healing_enabled?: boolean;
    },
  ) => void;
  onAutoFix: (application: Application, incident: SelfHealingIncident) => void;
}) {
  const zendeskConnected = integrations.find((i) => i.provider === 'zendesk')?.connected;
  const circleciConnected = integrations.find((i) => i.provider === 'circleci')?.connected;
  const slaConnected = integrations.find((i) => i.provider === 'sla')?.connected;
  const githubConnected = integrations.find((i) => i.provider === 'github')?.connected;
  const selectedWorkflow = resolveSelfHealingWorkflow(application, workflowTemplates);
  const pipelineSteps = (selectedWorkflow?.steps as WorkflowRole[] | undefined) ?? [];
  const effective = effectiveGoalWorkflowRoles(
    { ...(selectedWorkflow?.workflow_roles ?? {}) },
    application,
    pipelineSteps,
  );
  const missingWorkflow = !selectedWorkflow;
  const unknownWorkflow = !!application.self_healing_workflow_id && !selectedWorkflow;
  const missingDevelop = !!selectedWorkflow && !effective.develop;
  const missingDeploy = !!selectedWorkflow && pipelineSteps.includes('deploy') && !effective.deploy;
  const supportFixDisabled =
    !zendeskConnected ||
    !githubConnected ||
    !application.github_repo_url ||
    missingWorkflow ||
    unknownWorkflow ||
    missingDevelop ||
    missingDeploy;
  const ciFixDisabled =
    !circleciConnected ||
    !githubConnected ||
    !application.github_repo_url ||
    missingWorkflow ||
    unknownWorkflow ||
    missingDevelop ||
    missingDeploy;
  const slaFixDisabled =
    !slaConnected ||
    !githubConnected ||
    !application.github_repo_url ||
    missingWorkflow ||
    unknownWorkflow ||
    missingDevelop ||
    missingDeploy;
  // Security issues have no dedicated integration; gate only on GitHub + workflow.
  const securityFixDisabled =
    !githubConnected ||
    !application.github_repo_url ||
    missingWorkflow ||
    unknownWorkflow ||
    missingDevelop ||
    missingDeploy;
  const [activeViewTab, setActiveViewTab] = useState<SelfHealingViewTab>('incidents');
  const viewTabs: { id: SelfHealingViewTab; label: string; count: number }[] = [
    { id: 'incidents', label: 'Incidents', count: incidents.length },
    { id: 'ci_cd', label: 'CI/CD failures', count: ciIncidents.length },
    { id: 'sla_breach', label: 'SLA Breach', count: slaIncidents.length },
    { id: 'security', label: 'Security Issues', count: securityIssues.length },
  ];
  const supportFixUnavailableReason =
    !zendeskConnected
      ? 'Connect Zendesk to load incidents.'
      : !githubConnected
        ? 'Connect GitHub before auto-fix can open PRs.'
        : !application.github_repo_url
          ? 'Link a GitHub repository before auto-fix can run.'
          : unknownWorkflow
            ? 'The configured self-healing workflow no longer exists.'
            : missingWorkflow
              ? 'Create the standard workflow or keep only one saved workflow.'
              : missingDevelop
                ? 'The workflow must include a Development agent.'
                : missingDeploy
                  ? 'The workflow must include a Deployment agent.'
                  : undefined;

  const ciFixUnavailableReason = !circleciConnected
    ? 'Connect CircleCI in Integrations and add the webhook URL to your CircleCI project.'
    : !githubConnected
      ? 'Connect GitHub before auto-fix can open PRs.'
      : !application.github_repo_url
        ? 'Link a GitHub repository that matches your CircleCI project.'
        : unknownWorkflow
          ? 'The configured self-healing workflow no longer exists.'
          : missingWorkflow
            ? 'Create the standard workflow or keep only one saved workflow.'
            : missingDevelop
              ? 'The workflow must include a Development agent.'
              : missingDeploy
                ? 'The workflow must include a Deployment agent.'
                : undefined;

  const slaFixUnavailableReason = !slaConnected
    ? 'Connect SLA/SLO in Integrations and add the webhook URL to your Cloud Run SLO alert.'
    : !githubConnected
      ? 'Connect GitHub before auto-fix can open PRs.'
      : !application.github_repo_url
        ? 'Link a GitHub repository that matches your breached service.'
        : unknownWorkflow
          ? 'The configured self-healing workflow no longer exists.'
          : missingWorkflow
            ? 'Create the standard workflow or keep only one saved workflow.'
            : missingDevelop
              ? 'The workflow must include a Development agent.'
              : missingDeploy
                ? 'The workflow must include a Deployment agent.'
                : undefined;

  const securityFixUnavailableReason = !githubConnected
    ? 'Connect GitHub before auto-fix can open PRs.'
    : !application.github_repo_url
      ? 'Link a GitHub repository before auto-fix can run.'
      : unknownWorkflow
        ? 'The configured self-healing workflow no longer exists.'
        : missingWorkflow
          ? 'Create the standard workflow or keep only one saved workflow.'
          : missingDevelop
            ? 'The workflow must include a Development agent.'
            : missingDeploy
              ? 'The workflow must include a Deployment agent.'
              : undefined;

  function incidentGoal(incident: SelfHealingIncident): Goal | undefined {
    if (incident.kind === 'ci_cd' || incident.kind === 'sla_breach') {
      return goals.find((g) => g.id === incident.id);
    }
    if (incident.kind === 'security') {
      if (incident.goal_id) return goals.find((g) => g.id === incident.goal_id);
      const externalId = incident.key ?? `wiz:${incident.id}`;
      return goals.find(
        (g) =>
          g.application_id === application.id &&
          g.source === 'wiz' &&
          g.external_id === externalId,
      );
    }
    if (incident.goal_id) {
      return goals.find((g) => g.id === incident.goal_id);
    }
    const externalId = incident.key ?? `#${incident.id}`;
    return goals.find(
      (g) =>
        g.application_id === application.id &&
        g.source === 'zendesk' &&
        g.external_id === externalId,
    );
  }

  function fixingKey(incident: SelfHealingIncident) {
    const k = incident.kind ?? 'support';
    return `${incident.id}:${k}`;
  }

  return (
    <section className="self-healing-section" aria-label="Self-healing section">
      {activeViewTab === 'incidents' && loadError && <p className="alert alert-error">{loadError}</p>}
      {activeViewTab === 'ci_cd' && ciLoadError && <p className="alert alert-error">{ciLoadError}</p>}
      {activeViewTab === 'sla_breach' && slaLoadError && <p className="alert alert-error">{slaLoadError}</p>}
      {activeViewTab === 'security' && securityLoadError && (
        <p className="alert alert-error">{securityLoadError}</p>
      )}

      <div className="self-healing-simple-header">
        <p className="muted small">
          {application.self_healing_enabled
            ? 'When Auto fix is on, matching Zendesk tickets, failed CircleCI runs, and SLA/SLO breach webhooks start the standard workflow automatically.'
            : 'Zendesk incidents appear here from support; CircleCI and SLA/SLO failures appear in their tabs when webhooks fire. Use Fix/Open run to handle them manually.'}
        </p>
        <button
          type="button"
          className={
            application.self_healing_enabled
              ? 'btn btn-primary btn-sm self-healing-auto-toggle is-active'
              : 'btn btn-secondary btn-sm self-healing-auto-toggle'
          }
          disabled={saving}
          aria-pressed={application.self_healing_enabled}
          onClick={() =>
            onSettingsChange(application.id, {
              self_healing_enabled: !application.self_healing_enabled,
            })
          }
        >
          <span className="self-healing-auto-toggle-track" aria-hidden="true">
            <span className="self-healing-auto-toggle-knob" />
          </span>
          <span>Auto fix</span>
          <span className="self-healing-auto-toggle-state">
            {application.self_healing_enabled ? 'On' : 'Off'}
          </span>
        </button>
      </div>

      <div className="self-healing-layout">
        <div className="self-healing-section-tabs" role="tablist" aria-orientation="vertical">
          {viewTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeViewTab === tab.id}
              className={activeViewTab === tab.id ? 'self-healing-section-tab is-active' : 'self-healing-section-tab'}
              onClick={() => setActiveViewTab(tab.id)}
            >
              <span>{tab.label}</span>
              <span className="card-count">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="self-healing-section-panel">
          {activeViewTab === 'incidents' && (
            <div className="self-healing-incidents" role="tabpanel">
              {incidents.length === 0 ? (
                <p className="muted small self-healing-empty">No matching incidents found.</p>
              ) : (
                <div className="import-list self-healing-incident-list">
                  {incidents.map((incident) => {
                    const goal = incidentGoal(incident);
                    const isFixing = autoFixingIncidentId === fixingKey(incident);
                    const execStatus = goal?.execution_status ?? incident.execution_status;
                    const prUrl = goal?.pr_url ?? incident.pr_url;
                    const ticketStatus = (incident.status ?? '').toLowerCase();
                    const ticketResolved = ['solved', 'closed'].includes(ticketStatus);
                    const isRunning = execStatus === 'queued' || execStatus === 'running';
                    const isCompleted = execStatus === 'completed';
                    const isFailed = execStatus === 'failed';

                    let fixState: 'running' | 'fixed' | 'created' | 'failed' | 'idle';
                    if (isRunning) fixState = 'running';
                    else if (isCompleted && ticketResolved) fixState = 'fixed';
                    else if (isCompleted) fixState = 'created';
                    else if (isFailed) fixState = 'failed';
                    else fixState = 'idle';

                    return (
                      <div key={incident.id} className="import-item self-healing-incident">
                        <div className="import-item-content">
                          <div className="self-healing-incident-title">
                            <strong>{incident.key ?? `#${incident.id}`}</strong>
                            <span>{incident.title}</span>
                          </div>
                          {incident.status && (
                            <span className={`badge incident-ticket-badge badge-status-${ticketStatus || 'unknown'}`}>
                              {incident.status}
                            </span>
                          )}
                        </div>
                        <div className="self-healing-incident-actions">
                          {prUrl && (
                            <a
                              href={prUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm self-healing-pr-link"
                            >
                              <ExternalLinkIcon />
                              View PR
                            </a>
                          )}
                          {fixState === 'running' && (
                            <span className="status-pill status-pill-running">
                              <span className="status-dot" />
                              Fixing…
                            </span>
                          )}
                          {fixState === 'fixed' && (
                            <span className="status-pill status-pill-fixed">Fixed</span>
                          )}
                          {fixState === 'created' && (
                            <span className="status-pill status-pill-created">Fix created</span>
                          )}
                          {(fixState === 'idle' || fixState === 'failed') && (
                            <button
                              type="button"
                              className={fixState === 'failed' ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                              disabled={supportFixDisabled || isFixing}
                              title={supportFixDisabled ? supportFixUnavailableReason : undefined}
                              onClick={() => onAutoFix(application, incident)}
                            >
                              {isFixing ? 'Starting…' : fixState === 'failed' ? 'Retry fix' : 'Fix'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeViewTab === 'ci_cd' && (
            <div className="self-healing-incidents" role="tabpanel">
              {!circleciConnected ? (
                <p className="muted small self-healing-empty">
                  Connect CircleCI under Integrations, then add the webhook URL to your CircleCI project. Failed
                  workflows or jobs that match this application&apos;s GitHub repository will create goals here when
                  Auto fix is enabled.
                </p>
              ) : ciIncidents.length === 0 ? (
                <p className="muted small self-healing-empty">
                  No CircleCI failures recorded yet. Add the webhook in CircleCI (workflow-completed / job-completed
                  events) and ensure this application&apos;s linked repository matches the pipeline repository.
                </p>
              ) : (
                <div className="import-list self-healing-incident-list">
                  {ciIncidents.map((incident) => {
                    const goal = incidentGoal(incident);
                    const isFixing = autoFixingIncidentId === fixingKey(incident);
                    const execStatus = goal?.execution_status ?? incident.execution_status;
                    const prUrl = goal?.pr_url ?? incident.pr_url;
                    const isRunning = execStatus === 'queued' || execStatus === 'running';
                    const isCompleted = execStatus === 'completed';
                    const isFailed = execStatus === 'failed';

                    let fixState: 'running' | 'fixed' | 'created' | 'failed' | 'idle';
                    if (isRunning) fixState = 'running';
                    else if (isCompleted && prUrl) fixState = 'fixed';
                    else if (isCompleted) fixState = 'created';
                    else if (isFailed) fixState = 'failed';
                    else fixState = 'idle';

                    return (
                      <div key={incident.id} className="import-item self-healing-incident">
                        <div className="import-item-content">
                          <div className="self-healing-incident-title">
                            {incident.key && <strong className="self-healing-ci-key">{incident.key}</strong>}
                            <span>{incident.title}</span>
                          </div>
                          {incident.url && (
                            <a
                              href={incident.url}
                              target="_blank"
                              rel="noreferrer"
                              className="muted small self-healing-ci-circle-link"
                            >
                              Open in CircleCI
                            </a>
                          )}
                        </div>
                        <div className="self-healing-incident-actions">
                          {prUrl && (
                            <a
                              href={prUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm self-healing-pr-link"
                            >
                              <ExternalLinkIcon />
                              View PR
                            </a>
                          )}
                          {fixState === 'running' && (
                            <span className="status-pill status-pill-running">
                              <span className="status-dot" />
                              Fixing…
                            </span>
                          )}
                          {fixState === 'fixed' && (
                            <span className="status-pill status-pill-fixed">Merged / PR ready</span>
                          )}
                          {fixState === 'created' && (
                            <span className="status-pill status-pill-created">Run finished</span>
                          )}
                          {(fixState === 'idle' || fixState === 'failed') && (
                            <button
                              type="button"
                              className={fixState === 'failed' ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                              disabled={ciFixDisabled || isFixing}
                              title={ciFixDisabled ? ciFixUnavailableReason : undefined}
                              onClick={() => onAutoFix(application, incident)}
                            >
                              {isFixing
                                ? 'Working…'
                                : fixState === 'failed'
                                  ? goal?.resumable
                                    ? 'Retry fix'
                                    : 'Open run'
                                  : 'Open run'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeViewTab === 'sla_breach' && (
            <div className="self-healing-incidents" role="tabpanel">
              {!slaConnected ? (
                <p className="muted small self-healing-empty">
                  Connect SLA/SLO in Integrations, then configure the webhook URL in your Google Cloud Run SLO
                  alerting policy. Breach events that match this application will create goals here when Auto fix is
                  enabled.
                </p>
              ) : slaIncidents.length === 0 ? (
                <p className="muted small self-healing-empty">
                  No SLA breach events recorded yet. Send a test webhook from Cloud Monitoring / Cloud Run SLO
                  alerting and include service/repository metadata that matches this application.
                </p>
              ) : (
                <div className="import-list self-healing-incident-list">
                  {slaIncidents.map((incident) => {
                    const goal = incidentGoal(incident);
                    const isFixing = autoFixingIncidentId === fixingKey(incident);
                    const execStatus = goal?.execution_status ?? incident.execution_status;
                    const prUrl = goal?.pr_url ?? incident.pr_url;
                    const isRunning = execStatus === 'queued' || execStatus === 'running';
                    const isCompleted = execStatus === 'completed';
                    const isFailed = execStatus === 'failed';

                    let fixState: 'running' | 'fixed' | 'created' | 'failed' | 'idle';
                    if (isRunning) fixState = 'running';
                    else if (isCompleted && prUrl) fixState = 'fixed';
                    else if (isCompleted) fixState = 'created';
                    else if (isFailed) fixState = 'failed';
                    else fixState = 'idle';

                    return (
                      <div key={incident.id} className="import-item self-healing-incident">
                        <div className="import-item-content">
                          <div className="self-healing-incident-title">
                            {incident.key && <strong className="self-healing-ci-key">{incident.key}</strong>}
                            <span>{incident.title}</span>
                          </div>
                          {incident.url && (
                            <a
                              href={incident.url}
                              target="_blank"
                              rel="noreferrer"
                              className="muted small self-healing-ci-circle-link"
                            >
                              Open breach event
                            </a>
                          )}
                        </div>
                        <div className="self-healing-incident-actions">
                          {prUrl && (
                            <a
                              href={prUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm self-healing-pr-link"
                            >
                              <ExternalLinkIcon />
                              View PR
                            </a>
                          )}
                          {fixState === 'running' && (
                            <span className="status-pill status-pill-running">
                              <span className="status-dot" />
                              Fixing…
                            </span>
                          )}
                          {fixState === 'fixed' && (
                            <span className="status-pill status-pill-fixed">Merged / PR ready</span>
                          )}
                          {fixState === 'created' && (
                            <span className="status-pill status-pill-created">Run finished</span>
                          )}
                          {(fixState === 'idle' || fixState === 'failed') && (
                            <button
                              type="button"
                              className={fixState === 'failed' ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                              disabled={slaFixDisabled || isFixing}
                              title={slaFixDisabled ? slaFixUnavailableReason : undefined}
                              onClick={() => onAutoFix(application, incident)}
                            >
                              {isFixing
                                ? 'Working…'
                                : fixState === 'failed'
                                  ? goal?.resumable
                                    ? 'Retry fix'
                                    : 'Open run'
                                  : 'Open run'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeViewTab === 'security' && (
            <div className="self-healing-incidents" role="tabpanel">
              {securityIssues.length === 0 ? (
                <p className="muted small self-healing-empty">
                  No security issues yet. POST a Wiz issues payload to this application to populate
                  this tab.
                </p>
              ) : (
                <div className="import-list self-healing-incident-list">
                  {securityIssues.map((incident) => {
                    const goal = incidentGoal(incident);
                    const isFixing = autoFixingIncidentId === fixingKey(incident);
                    const execStatus = goal?.execution_status ?? incident.execution_status;
                    const prUrl = goal?.pr_url ?? incident.pr_url;
                    const severity = (incident.priority ?? '').toLowerCase();
                    const issueStatus = (incident.status ?? '').toLowerCase();
                    const isRunning = execStatus === 'queued' || execStatus === 'running';
                    const isCompleted = execStatus === 'completed';
                    const isFailed = execStatus === 'failed';

                    let fixState: 'running' | 'fixed' | 'created' | 'failed' | 'idle';
                    if (isRunning) fixState = 'running';
                    else if (isCompleted && prUrl) fixState = 'fixed';
                    else if (isCompleted) fixState = 'created';
                    else if (isFailed) fixState = 'failed';
                    else fixState = 'idle';

                    return (
                      <div key={incident.id} className="import-item self-healing-incident">
                        <div className="import-item-content">
                          <div className="self-healing-incident-title">
                            {severity && (
                              <span className={`badge incident-ticket-badge badge-severity-${severity}`}>
                                {severity.toUpperCase()}
                              </span>
                            )}
                            <span>{incident.title}</span>
                          </div>
                          {incident.url && (
                            <a
                              href={incident.url}
                              target="_blank"
                              rel="noreferrer"
                              className="muted small self-healing-ci-circle-link"
                            >
                              Open in Wiz
                            </a>
                          )}
                        </div>
                        <div className="self-healing-incident-actions">
                          {incident.status && (
                            <span className={`badge incident-ticket-badge badge-status-${issueStatus || 'unknown'}`}>
                              {incident.status}
                            </span>
                          )}
                          {prUrl && (
                            <a
                              href={prUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm self-healing-pr-link"
                            >
                              <ExternalLinkIcon />
                              View PR
                            </a>
                          )}
                          {fixState === 'running' && (
                            <span className="status-pill status-pill-running">
                              <span className="status-dot" />
                              Fixing…
                            </span>
                          )}
                          {fixState === 'fixed' && (
                            <span className="status-pill status-pill-fixed">Merged / PR ready</span>
                          )}
                          {fixState === 'created' && (
                            <span className="status-pill status-pill-created">Fix created</span>
                          )}
                          {(fixState === 'idle' || fixState === 'failed') && (
                            <button
                              type="button"
                              className={fixState === 'failed' ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                              disabled={securityFixDisabled || isFixing}
                              title={securityFixDisabled ? securityFixUnavailableReason : undefined}
                              onClick={() => onAutoFix(application, incident)}
                            >
                              {isFixing
                                ? 'Starting…'
                                : fixState === 'failed'
                                  ? goal?.resumable
                                    ? 'Retry fix'
                                    : 'Open run'
                                  : 'Fix'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ApplicationKanban({
  application,
  goals,
  scopedGoals,
  allowCreate = true,
  onGoalsChange,
  onError,
  onGoalExecuting,
  integrations,
  githubRepoLinked,
  workflowTemplates,
  onRefreshWorkflowTemplates,
}: {
  application: Application;
  goals: Goal[];
  scopedGoals?: Goal[];
  allowCreate?: boolean;
  onGoalsChange: (updater: (prev: Goal[]) => Goal[]) => void;
  onError: (message: string) => void;
  onGoalExecuting: (goal: Goal) => void;
  integrations: IntegrationStatus[];
  githubRepoLinked: boolean;
  workflowTemplates: WorkflowDefinition[];
  onRefreshWorkflowTemplates?: () => void | Promise<void>;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<GoalStatus | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importTab, setImportTab] = useState<'manual' | 'jira' | 'trello' | 'zendesk'>('manual');
  const [jiraIssues, setJiraIssues] = useState<ExternalIssue[]>([]);
  const [jiraSpaces, setJiraSpaces] = useState<JiraSpace[]>([]);
  const [jiraLoadError, setJiraLoadError] = useState<string | null>(null);
  const [trelloCards, setTrelloCards] = useState<ExternalCard[]>([]);
  const [zendeskTickets, setZendeskTickets] = useState<ExternalIssue[]>([]);
  const [zendeskLoadError, setZendeskLoadError] = useState<string | null>(null);
  const [jiraLoaded, setJiraLoaded] = useState(false);
  const [trelloLoaded, setTrelloLoaded] = useState(false);
  const [zendeskLoaded, setZendeskLoaded] = useState(false);

  const jiraConnected = integrations.find((i) => i.provider === 'jira')?.connected;
  const trelloConnected = integrations.find((i) => i.provider === 'trello')?.connected;
  const zendeskConnected = integrations.find((i) => i.provider === 'zendesk')?.connected;
  const jiraLoading = showCreateModal && importTab === 'jira' && jiraConnected && !jiraLoaded;
  const trelloLoading = showCreateModal && importTab === 'trello' && trelloConnected && !trelloLoaded;
  const zendeskLoading = showCreateModal && importTab === 'zendesk' && zendeskConnected && !zendeskLoaded;

  const applicationId = application.id;
  const appGoals =
    scopedGoals ?? goals.filter((g) => g.application_id === applicationId);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');

  useEffect(() => {
    if (!showCreateModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeCreateModal();
    }
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [showCreateModal]);

  useEffect(() => {
    if (!showCreateModal || importTab !== 'jira' || !jiraConnected || jiraLoaded) return;
    let cancelled = false;

    async function loadJiraImportData() {
      try {
        const [issues, spaces] = await Promise.all([listJiraIssues(), listJiraSpaces()]);
        if (cancelled) return;
        setJiraIssues(issues);
        setJiraSpaces(spaces);
        setJiraLoadError(null);
        setJiraLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setJiraIssues([]);
        setJiraSpaces([]);
        setJiraLoadError(e instanceof Error ? e.message : 'Failed to load Jira issues');
      }
    }

    void loadJiraImportData();
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, importTab, jiraConnected, jiraLoaded]);

  useEffect(() => {
    if (!showCreateModal || importTab !== 'trello' || !trelloConnected || trelloLoaded) return;
    let cancelled = false;

    async function loadTrelloImportData() {
      try {
        const cards = await listTrelloCards();
        if (cancelled) return;
        setTrelloCards(cards);
        setTrelloLoaded(true);
      } catch {
        if (cancelled) return;
        setTrelloCards([]);
      }
    }

    void loadTrelloImportData();
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, importTab, trelloConnected, trelloLoaded]);

  useEffect(() => {
    if (!showCreateModal || importTab !== 'zendesk' || !zendeskConnected || zendeskLoaded) return;
    let cancelled = false;

    async function loadZendeskImportData() {
      try {
        const tickets = await listZendeskTickets();
        if (cancelled) return;
        setZendeskTickets(tickets);
        setZendeskLoadError(null);
        setZendeskLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setZendeskTickets([]);
        setZendeskLoadError(e instanceof Error ? e.message : 'Failed to load Zendesk tickets');
      }
    }

    void loadZendeskImportData();
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, importTab, zendeskConnected, zendeskLoaded]);

  function closeCreateModal() {
    setShowCreateModal(false);
    setTitle('');
    setDescription('');
    setImportTab('manual');
    setSelectedWorkflowId('');
  }

  const selectedWorkflowTemplate =
    workflowTemplates.find((w) => w.id === selectedWorkflowId) ?? workflowTemplates[0];
  const activeWorkflowId = selectedWorkflowTemplate?.id ?? '';
  const goalPipelineSteps: WorkflowRole[] =
    (selectedWorkflowTemplate?.steps as WorkflowRole[] | undefined) ?? [];

  function buildEffectiveWorkflowRolesForGoal(): WorkflowRoles {
    return effectiveGoalWorkflowRoles(
      { ...(selectedWorkflowTemplate?.workflow_roles ?? {}) },
      application,
      goalPipelineSteps,
    );
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!githubRepoLinked) {
      onError('Link a GitHub repository to this application before creating a goal.');
      return;
    }
    if (!activeWorkflowId) {
      onError('Select a workflow. Create one under Workflows if you have not yet.');
      return;
    }
    const effective = buildEffectiveWorkflowRolesForGoal();
    if (!effective.develop) {
      onError(
        'The selected workflow (or your application) must supply a Development agent for this pipeline.',
      );
      return;
    }
    if (goalPipelineSteps.includes('deploy') && !effective.deploy) {
      onError(
        'The selected workflow (or your application) must supply a Deployment agent when deployment is in the pipeline.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const created = await createGoal(
        applicationId,
        title.trim(),
        description.trim(),
        effective,
        { workflow_id: activeWorkflowId },
      );
      onGoalsChange((prev) => [created, ...prev]);
      closeCreateModal();
      onGoalExecuting(created);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to create goal');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportFromJira(issueKey: string) {
    if (!activeWorkflowId) {
      onError('Select a workflow before importing from Jira.');
      return;
    }
    const effective = buildEffectiveWorkflowRolesForGoal();
    if (!effective.develop) {
      onError(
        'The selected workflow (or your application) must supply a Development agent before importing from Jira.',
      );
      return;
    }
    if (goalPipelineSteps.includes('deploy') && !effective.deploy) {
      onError(
        'The selected workflow (or your application) must supply a Deployment agent before importing from Jira.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const created = await createGoalFromJira(
        applicationId,
        issueKey,
        effective,
        { workflow_id: activeWorkflowId },
      );
      onGoalsChange((prev) => [created, ...prev]);
      closeCreateModal();
      onGoalExecuting(created);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to import from Jira');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportFromTrello(cardId: string) {
    if (!activeWorkflowId) {
      onError('Select a workflow before importing from Trello.');
      return;
    }
    const effective = buildEffectiveWorkflowRolesForGoal();
    if (!effective.develop) {
      onError(
        'The selected workflow (or your application) must supply a Development agent before importing from Trello.',
      );
      return;
    }
    if (goalPipelineSteps.includes('deploy') && !effective.deploy) {
      onError(
        'The selected workflow (or your application) must supply a Deployment agent before importing from Trello.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const created = await createGoalFromTrello(
        applicationId,
        cardId,
        effective,
        { workflow_id: activeWorkflowId },
      );
      onGoalsChange((prev) => [created, ...prev]);
      closeCreateModal();
      onGoalExecuting(created);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to import from Trello');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportFromZendesk(ticketId: string) {
    if (!activeWorkflowId) {
      onError('Select a workflow before importing from Zendesk.');
      return;
    }
    const effective = buildEffectiveWorkflowRolesForGoal();
    if (!effective.develop) {
      onError(
        'The selected workflow (or your application) must supply a Development agent before importing from Zendesk.',
      );
      return;
    }
    if (goalPipelineSteps.includes('deploy') && !effective.deploy) {
      onError(
        'The selected workflow (or your application) must supply a Deployment agent before importing from Zendesk.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const created = await createGoalFromZendesk(
        applicationId,
        ticketId,
        effective,
        { workflow_id: activeWorkflowId },
      );
      onGoalsChange((prev) => [created, ...prev]);
      closeCreateModal();
      onGoalExecuting(created);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to import from Zendesk');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this goal?')) return;
    try {
      await deleteGoal(id);
      onGoalsChange((prev) => prev.filter((g) => g.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to delete goal');
    }
  }

  async function handleResume(goal: Goal) {
    try {
      const updated = await resumeGoal(goal.id);
      onGoalsChange((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      onGoalExecuting(updated);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to resume goal');
    }
  }

  function handleDragStart(e: DragEvent, goalId: string) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', goalId);
    setDraggingId(goalId);
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDropTarget(null);
  }

  function handleDragOver(e: DragEvent, laneId: GoalStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(laneId);
  }

  function handleDragLeave(e: DragEvent, laneId: GoalStatus) {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    if (dropTarget === laneId) setDropTarget(null);
  }

  async function handleDrop(e: DragEvent, laneId: GoalStatus) {
    e.preventDefault();
    setDropTarget(null);
    setDraggingId(null);

    const goalId = e.dataTransfer.getData('text/plain');
    if (!goalId) return;

    const goal = appGoals.find((g) => g.id === goalId);
    if (!goal || goal.status === laneId) return;

    onGoalsChange((prev) =>
      prev.map((g) => (g.id === goalId ? { ...g, status: laneId } : g)),
    );

    try {
      await updateGoal(goalId, { status: laneId });
    } catch (err) {
      onGoalsChange((prev) =>
        prev.map((g) => (g.id === goalId ? { ...g, status: goal.status } : g)),
      );
      onError(err instanceof Error ? err.message : 'Failed to move goal');
    }
  }

  function goalsInLane(laneId: GoalStatus) {
    return appGoals.filter((g) => (g.status ?? 'backlog') === laneId);
  }

  const createModal = showCreateModal && (
    <div className="modal-overlay" role="presentation" onClick={closeCreateModal}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-goal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="create-goal-title">Add goal</h2>
          <button type="button" className="modal-close" onClick={closeCreateModal} aria-label="Close">
            ×
          </button>
        </div>

        <div className="tabs">
          <button
            type="button"
            className={importTab === 'manual' ? 'tab active' : 'tab'}
            onClick={() => setImportTab('manual')}
          >
            Manual
          </button>
          <button
            type="button"
            className={importTab === 'jira' ? 'tab active' : 'tab'}
            onClick={() => setImportTab('jira')}
            disabled={!jiraConnected}
            title={!jiraConnected ? 'Connect Jira in Integrations' : undefined}
          >
            From Jira
          </button>
          <button
            type="button"
            className={importTab === 'trello' ? 'tab active' : 'tab'}
            onClick={() => setImportTab('trello')}
            disabled={!trelloConnected}
            title={!trelloConnected ? 'Connect Trello in Integrations' : undefined}
          >
            From Trello
          </button>
          <button
            type="button"
            className={importTab === 'zendesk' ? 'tab active' : 'tab'}
            onClick={() => setImportTab('zendesk')}
            disabled={!zendeskConnected}
            title={!zendeskConnected ? 'Connect Zendesk in Integrations' : undefined}
          >
            From Zendesk
          </button>
        </div>

        <fieldset className="fieldset goal-workflow-template-select">
          <legend>Implementation workflow</legend>
          <p className="muted small">
            Goals use one of your saved workflows from <Link to="/workflows">Workflows</Link>. Roles defined on
            the workflow are used first; any missing role can still inherit from the application.
          </p>
          {workflowTemplates.length > 0 ? (
            <label>
              Workflow
              <select
                required
                value={activeWorkflowId}
                onChange={(e) => {
                  setSelectedWorkflowId(e.target.value);
                }}
              >
                {workflowTemplates.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted small">
              Create at least one workflow under <Link to="/workflows">Workflows</Link> before you can add a
              goal.
            </p>
          )}
        </fieldset>

        {importTab === 'manual' && (
          <form onSubmit={handleManualSubmit} className="form">
            <label>
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={500}
                placeholder="What do you want to achieve?"
                autoFocus
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={10000}
                placeholder="Add context, acceptance criteria, or notes…"
              />
            </label>
            {!githubRepoLinked && (
              <p className="muted small">
                Link a GitHub repository on this application before creating a goal.
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !githubRepoLinked || !activeWorkflowId}
              >
                <PlusIcon />
                {submitting ? 'Starting agent…' : 'Create & run goal'}
              </button>
            </div>
          </form>
        )}

        {importTab === 'jira' && (
          jiraLoading ? (
            <div className="empty-state">
              <LoadingIndicator />
              <p className="muted">Loading Jira issues...</p>
            </div>
          ) : (
            <JiraImportPanel
              issues={jiraIssues}
              spaces={jiraSpaces}
              loadError={jiraLoadError ?? null}
              submitting={submitting}
              importDisabled={!activeWorkflowId}
              onImport={handleImportFromJira}
            />
          )
        )}

        {importTab === 'trello' && (
          <div className="import-list">
            {trelloLoading ? (
              <div className="empty-state">
                <LoadingIndicator />
                <p className="muted">Loading Trello cards...</p>
              </div>
            ) : trelloCards.length === 0 ? (
              <p className="muted">No Trello cards found or still loading.</p>
            ) : (
              trelloCards.map((card) => (
                <div key={card.id} className="import-item">
                  <div className="import-item-content">
                    <strong>{card.title}</strong>
                    {card.board_name && <span className="badge badge-manual"> {card.board_name}</span>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={submitting || !activeWorkflowId}
                    onClick={() => handleImportFromTrello(card.id)}
                  >
                    <PlusIcon />
                    Import
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {importTab === 'zendesk' && (
          zendeskLoading ? (
            <div className="empty-state">
              <LoadingIndicator />
              <p className="muted">Loading Zendesk tickets...</p>
            </div>
          ) : (
            <JiraImportPanel
              issues={zendeskTickets}
              spaces={[]}
              loadError={zendeskLoadError ?? null}
              submitting={submitting}
              importDisabled={!activeWorkflowId}
              onImport={handleImportFromZendesk}
              emptyMessage="No Zendesk tickets found."
              searchPlaceholder="Search by ticket #, title, or status…"
              resolveImportId={(issue) => issue.id}
            />
          )
        )}
      </div>
    </div>
  );

  return (
    <>
      {createModal ? createPortal(createModal, document.body) : null}
      <div className="kanban-board">
        {KANBAN_LANES.map((lane) => {
          const laneGoals = goalsInLane(lane.id);
          const isDropTarget = dropTarget === lane.id;
          const isBacklog = lane.id === 'backlog';
          return (
            <div
              key={lane.id}
              className={`kanban-lane kanban-lane-${lane.id}${isDropTarget ? ' kanban-lane-drop-target' : ''}`}
              onDragOver={(e) => handleDragOver(e, lane.id)}
              onDragLeave={(e) => handleDragLeave(e, lane.id)}
              onDrop={(e) => handleDrop(e, lane.id)}
            >
              <div className="kanban-lane-header">
                <h3>{lane.label}</h3>
                <span className="kanban-lane-count">{laneGoals.length}</span>
              </div>
              <div className="kanban-lane-body">
                {isBacklog && allowCreate && (
                  <button
                    type="button"
                    className="kanban-lane-add"
                    onClick={() => {
                      void onRefreshWorkflowTemplates?.();
                      setShowCreateModal(true);
                    }}
                  >
                    <PlusIcon />
                    Add goal
                  </button>
                )}
                {laneGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onDelete={handleDelete}
                    viewTo={goalExecutionPath(goal)}
                    onResume={goal.resumable ? handleResume : undefined}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                ))}
                {!isBacklog && laneGoals.length === 0 && (
                  <p className="kanban-lane-empty">{draggingId ? 'Drop here' : 'No goals'}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ApplicationDetailPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const openGoalExecution = useCallback(
    (goal: Goal) => {
      navigate(goalExecutionPath(goal));
    },
    [navigate],
  );
  const [applications, setApplications] = useState<Application[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [reposLoadError, setReposLoadError] = useState<string | null>(null);
  const [selfHealingIncidents, setSelfHealingIncidents] = useState<Record<string, SelfHealingIncident[]>>({});
  const [selfHealingLoadErrors, setSelfHealingLoadErrors] = useState<Record<string, string | null>>({});
  const [selfHealingCiIncidents, setSelfHealingCiIncidents] = useState<Record<string, SelfHealingIncident[]>>({});
  const [selfHealingCiLoadErrors, setSelfHealingCiLoadErrors] = useState<Record<string, string | null>>({});
  const [selfHealingSlaIncidents, setSelfHealingSlaIncidents] = useState<Record<string, SelfHealingIncident[]>>({});
  const [selfHealingSlaLoadErrors, setSelfHealingSlaLoadErrors] = useState<Record<string, string | null>>({});
  const [selfHealingSecurityIssues, setSelfHealingSecurityIssues] = useState<Record<string, SelfHealingIncident[]>>({});
  const [selfHealingSecurityLoadErrors, setSelfHealingSecurityLoadErrors] = useState<Record<string, string | null>>({});
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingRepoFor, setSavingRepoFor] = useState<string | null>(null);
  const [savingSelfHealingFor, setSavingSelfHealingFor] = useState<string | null>(null);
  const [savingCloudInfrastructureFor, setSavingCloudInfrastructureFor] = useState<string | null>(null);
  const [autoFixingIncident, setAutoFixingIncident] = useState<string | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<ApplicationViewTab>('delivery_goals');
  const [showAppModal, setShowAppModal] = useState(false);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [appTitle, setAppTitle] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [appSelfHealingWorkflowId, setAppSelfHealingWorkflowId] = useState('');

  const githubConnected = integrations.find((i) => i.provider === 'github')?.connected;

  const refreshWorkflowTemplates = useCallback(async () => {
    try {
      const res = await listWorkflows();
      setWorkflowTemplates(res.workflows ?? []);
    } catch {
      /* keep existing list */
    }
  }, []);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setActiveViewTab('delivery_goals');
  }, [applicationId]);

  useEffect(() => {
    const viewingConcreteApp = !!applicationId && applicationId !== APPLICATION_UNASSIGNED_SLUG;
    if (!githubConnected) {
      setGithubRepos([]);
      setReposLoadError(null);
      return;
    }
    if (!viewingConcreteApp && !showAppModal) return;
    if (githubRepos.length > 0) return;

    let cancelled = false;
    async function loadGithubReposIfNeeded() {
      try {
        const repos = await listGitHubRepos();
        if (cancelled) return;
        setGithubRepos(repos);
        setReposLoadError(null);
      } catch (e) {
        if (cancelled) return;
        setGithubRepos([]);
        setReposLoadError(e instanceof Error ? e.message : 'Failed to load GitHub repositories');
      }
    }

    void loadGithubReposIfNeeded();
    return () => {
      cancelled = true;
    };
  }, [applicationId, githubConnected, githubRepos.length, showAppModal]);

  useEffect(() => {
    const currentAppId =
      applicationId && applicationId !== APPLICATION_UNASSIGNED_SLUG ? applicationId : null;
    const zendeskConnected = integrations.find((i) => i.provider === 'zendesk')?.connected;
    if (!currentAppId || activeViewTab !== 'self_healing') return;
    const appId = currentAppId;
    if (!zendeskConnected) {
      setSelfHealingIncidents((prev) => ({ ...prev, [appId]: [] }));
      setSelfHealingLoadErrors((prev) => ({ ...prev, [appId]: null }));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(selfHealingIncidents, appId)) return;

    let cancelled = false;
    async function loadSelfHealingIncidentsForCurrentApp() {
      try {
        const incidents = await listSelfHealingIncidents(appId);
        if (cancelled) return;
        setSelfHealingIncidents((prev) => ({ ...prev, [appId]: incidents }));
        setSelfHealingLoadErrors((prev) => ({ ...prev, [appId]: null }));
      } catch (e) {
        if (cancelled) return;
        setSelfHealingIncidents((prev) => ({ ...prev, [appId]: [] }));
        setSelfHealingLoadErrors((prev) => ({
          ...prev,
          [appId]: e instanceof Error ? e.message : 'Failed to load self-healing incidents',
        }));
      }
    }

    void loadSelfHealingIncidentsForCurrentApp();
    return () => {
      cancelled = true;
    };
  }, [applicationId, activeViewTab, integrations, selfHealingIncidents]);

  useEffect(() => {
    const currentAppId =
      applicationId && applicationId !== APPLICATION_UNASSIGNED_SLUG ? applicationId : null;
    const circleciConnected = integrations.find((i) => i.provider === 'circleci')?.connected;
    if (!currentAppId || activeViewTab !== 'self_healing') return;
    const appId = currentAppId;
    if (!circleciConnected) {
      setSelfHealingCiIncidents((prev) => ({ ...prev, [appId]: [] }));
      setSelfHealingCiLoadErrors((prev) => ({ ...prev, [appId]: null }));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(selfHealingCiIncidents, appId)) return;

    let cancelled = false;
    async function loadSelfHealingCiForCurrentApp() {
      try {
        const rows = await listSelfHealingCiFailures(appId);
        if (cancelled) return;
        setSelfHealingCiIncidents((prev) => ({ ...prev, [appId]: rows }));
        setSelfHealingCiLoadErrors((prev) => ({ ...prev, [appId]: null }));
      } catch (e) {
        if (cancelled) return;
        setSelfHealingCiIncidents((prev) => ({ ...prev, [appId]: [] }));
        setSelfHealingCiLoadErrors((prev) => ({
          ...prev,
          [appId]: e instanceof Error ? e.message : 'Failed to load CI/CD failures',
        }));
      }
    }

    void loadSelfHealingCiForCurrentApp();
    return () => {
      cancelled = true;
    };
  }, [applicationId, activeViewTab, integrations, selfHealingCiIncidents]);

  useEffect(() => {
    const currentAppId =
      applicationId && applicationId !== APPLICATION_UNASSIGNED_SLUG ? applicationId : null;
    const slaConnected = integrations.find((i) => i.provider === 'sla')?.connected;
    if (!currentAppId || activeViewTab !== 'self_healing') return;
    const appId = currentAppId;
    if (!slaConnected) {
      setSelfHealingSlaIncidents((prev) => ({ ...prev, [appId]: [] }));
      setSelfHealingSlaLoadErrors((prev) => ({ ...prev, [appId]: null }));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(selfHealingSlaIncidents, appId)) return;

    let cancelled = false;
    async function loadSelfHealingSlaForCurrentApp() {
      try {
        const rows = await listSelfHealingSlaBreaches(appId);
        if (cancelled) return;
        setSelfHealingSlaIncidents((prev) => ({ ...prev, [appId]: rows }));
        setSelfHealingSlaLoadErrors((prev) => ({ ...prev, [appId]: null }));
      } catch (e) {
        if (cancelled) return;
        setSelfHealingSlaIncidents((prev) => ({ ...prev, [appId]: [] }));
        setSelfHealingSlaLoadErrors((prev) => ({
          ...prev,
          [appId]: e instanceof Error ? e.message : 'Failed to load SLA breaches',
        }));
      }
    }

    void loadSelfHealingSlaForCurrentApp();
    return () => {
      cancelled = true;
    };
  }, [applicationId, activeViewTab, integrations, selfHealingSlaIncidents]);

  // Security issues (Wiz) have no integration to gate on — load whenever the
  // self-healing view is active and we haven't cached this app yet.
  useEffect(() => {
    const currentAppId =
      applicationId && applicationId !== APPLICATION_UNASSIGNED_SLUG ? applicationId : null;
    if (!currentAppId || activeViewTab !== 'self_healing') return;
    const appId = currentAppId;
    if (Object.prototype.hasOwnProperty.call(selfHealingSecurityIssues, appId)) return;

    let cancelled = false;
    async function loadSelfHealingSecurityForCurrentApp() {
      try {
        const rows = await listSelfHealingSecurityIssues(appId);
        if (cancelled) return;
        setSelfHealingSecurityIssues((prev) => ({ ...prev, [appId]: rows }));
        setSelfHealingSecurityLoadErrors((prev) => ({ ...prev, [appId]: null }));
      } catch (e) {
        if (cancelled) return;
        setSelfHealingSecurityIssues((prev) => ({ ...prev, [appId]: [] }));
        setSelfHealingSecurityLoadErrors((prev) => ({
          ...prev,
          [appId]: e instanceof Error ? e.message : 'Failed to load security issues',
        }));
      }
    }

    void loadSelfHealingSecurityForCurrentApp();
    return () => {
      cancelled = true;
    };
  }, [applicationId, activeViewTab, selfHealingSecurityIssues]);

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
    setAppSelfHealingWorkflowId('');
  }

  function openEditApplication(app: Application) {
    setEditingApplicationId(app.id);
    setAppTitle(app.title);
    setAppDescription(app.description ?? '');
    setAppSelfHealingWorkflowId(app.self_healing_workflow_id ?? '');
    setShowAppModal(true);
  }

  async function handleRepoChange(applicationId: string, url: string) {
    setSavingRepoFor(applicationId);
    setError(null);
    try {
      const updated = await updateApplication(applicationId, {
        github_repo_url: url || null,
      });
      setApplications((prev) => prev.map((a) => (a.id === applicationId ? updated : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update repository');
    } finally {
      setSavingRepoFor(null);
    }
  }

  async function handleCloudInfrastructureSave(
    applicationId: string,
    items: CloudInfrastructureItem[],
  ) {
    setSavingCloudInfrastructureFor(applicationId);
    setError(null);
    try {
      const updated = await updateApplication(applicationId, {
        cloud_infrastructure: items,
      });
      setApplications((prev) => prev.map((a) => (a.id === applicationId ? updated : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update cloud infrastructure');
      throw e;
    } finally {
      setSavingCloudInfrastructureFor(null);
    }
  }

  async function refreshSelfHealingIncidents(applicationId: string) {
    setSelfHealingLoadErrors((prev) => ({ ...prev, [applicationId]: null }));
    try {
      const incidents = await listSelfHealingIncidents(applicationId);
      setSelfHealingIncidents((prev) => ({ ...prev, [applicationId]: incidents }));
    } catch (e) {
      setSelfHealingIncidents((prev) => ({ ...prev, [applicationId]: [] }));
      setSelfHealingLoadErrors((prev) => ({
        ...prev,
        [applicationId]: e instanceof Error ? e.message : 'Failed to load self-healing incidents',
      }));
    }
  }

  async function refreshSelfHealingCiIncidents(applicationId: string) {
    setSelfHealingCiLoadErrors((prev) => ({ ...prev, [applicationId]: null }));
    try {
      const rows = await listSelfHealingCiFailures(applicationId);
      setSelfHealingCiIncidents((prev) => ({ ...prev, [applicationId]: rows }));
    } catch (e) {
      setSelfHealingCiIncidents((prev) => ({ ...prev, [applicationId]: [] }));
      setSelfHealingCiLoadErrors((prev) => ({
        ...prev,
        [applicationId]: e instanceof Error ? e.message : 'Failed to load CI/CD failures',
      }));
    }
  }

  async function refreshSelfHealingSlaIncidents(applicationId: string) {
    setSelfHealingSlaLoadErrors((prev) => ({ ...prev, [applicationId]: null }));
    try {
      const rows = await listSelfHealingSlaBreaches(applicationId);
      setSelfHealingSlaIncidents((prev) => ({ ...prev, [applicationId]: rows }));
    } catch (e) {
      setSelfHealingSlaIncidents((prev) => ({ ...prev, [applicationId]: [] }));
      setSelfHealingSlaLoadErrors((prev) => ({
        ...prev,
        [applicationId]: e instanceof Error ? e.message : 'Failed to load SLA breaches',
      }));
    }
  }

  async function refreshSelfHealingSecurityIssues(applicationId: string) {
    setSelfHealingSecurityLoadErrors((prev) => ({ ...prev, [applicationId]: null }));
    try {
      const rows = await listSelfHealingSecurityIssues(applicationId);
      setSelfHealingSecurityIssues((prev) => ({ ...prev, [applicationId]: rows }));
    } catch (e) {
      setSelfHealingSecurityIssues((prev) => ({ ...prev, [applicationId]: [] }));
      setSelfHealingSecurityLoadErrors((prev) => ({
        ...prev,
        [applicationId]: e instanceof Error ? e.message : 'Failed to load security issues',
      }));
    }
  }

  async function handleSelfHealingSettingsChange(
    applicationId: string,
    updates: {
      self_healing_enabled?: boolean;
    },
  ) {
    setSavingSelfHealingFor(applicationId);
    setError(null);
    try {
      const updated = await updateApplication(applicationId, updates);
      setApplications((prev) => prev.map((a) => (a.id === applicationId ? updated : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update self-healing settings');
    } finally {
      setSavingSelfHealingFor(null);
    }
  }

  async function handleSelfHealingAutoFix(application: Application, incident: SelfHealingIncident) {
    if (incident.kind === 'security') {
      const externalId = incident.key ?? `wiz:${incident.id}`;
      const existing = incident.goal_id
        ? goals.find((g) => g.id === incident.goal_id)
        : goals.find(
            (g) =>
              g.application_id === application.id &&
              g.source === 'wiz' &&
              g.external_id === externalId,
          );
      const key = `${application.id}:${incident.id}:security`;
      if (existing) {
        setAutoFixingIncident(key);
        setError(null);
        try {
          if (existing.execution_status === 'failed' && existing.resumable) {
            const updated = await resumeGoal(existing.id);
            setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
            await refreshSelfHealingSecurityIssues(application.id);
          } else {
            navigate(goalExecutionPath(existing));
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to update goal');
        } finally {
          setAutoFixingIncident(null);
        }
        return;
      }

      const configuredWorkflowId = application.self_healing_workflow_id?.trim();
      const workflow = resolveSelfHealingWorkflow(application, workflowTemplates);
      if (!workflow) {
        setError(
          configuredWorkflowId
            ? 'The configured self-healing workflow no longer exists.'
            : 'Create the standard workflow or keep only one saved workflow.',
        );
        return;
      }
      if (!application.github_repo_url) {
        setError('Link a GitHub repository to this application before starting auto-fix.');
        return;
      }
      const steps = (workflow?.steps as WorkflowRole[] | undefined) ?? [];
      const effective = effectiveGoalWorkflowRoles(
        { ...(workflow?.workflow_roles ?? {}) },
        application,
        steps,
      );
      if (!effective.develop) {
        setError('The standard workflow must supply a Development agent before auto-fix can run.');
        return;
      }
      if (steps.includes('deploy') && !effective.deploy) {
        setError('The standard workflow must supply a Deployment agent before auto-fix can run.');
        return;
      }

      setAutoFixingIncident(key);
      setError(null);
      try {
        const created = await createGoalFromWiz(application.id, incident.id, effective, {
          workflow_id: workflow.id,
        });
        setGoals((prev) => [created, ...prev.filter((g) => g.id !== created.id)]);
        navigate(goalExecutionPath(created));
        await refreshSelfHealingSecurityIssues(application.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start auto-fix');
      } finally {
        setAutoFixingIncident(null);
      }
      return;
    }

    if (incident.kind === 'ci_cd' || incident.kind === 'sla_breach') {
      const goal = goals.find((g) => g.id === incident.id);
      if (!goal) {
        setError('Goal not found for this incident.');
        return;
      }
      const kind = incident.kind === 'sla_breach' ? 'sla_breach' : 'ci_cd';
      const key = `${application.id}:${incident.id}:${kind}`;
      setAutoFixingIncident(key);
      setError(null);
      try {
        if (goal.execution_status === 'failed' && goal.resumable) {
          const updated = await resumeGoal(incident.id);
          setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
          if (incident.kind === 'sla_breach') await refreshSelfHealingSlaIncidents(application.id);
          else await refreshSelfHealingCiIncidents(application.id);
        } else {
          navigate(goalExecutionPath(goal));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update goal');
      } finally {
        setAutoFixingIncident(null);
      }
      return;
    }

    const configuredWorkflowId = application.self_healing_workflow_id?.trim();
    const workflow = resolveSelfHealingWorkflow(application, workflowTemplates);
    if (!workflow) {
      setError(
        configuredWorkflowId
          ? 'The configured self-healing workflow no longer exists.'
          : 'Create the standard workflow or keep only one saved workflow.',
      );
      return;
    }
    if (!application.github_repo_url) {
      setError('Link a GitHub repository to this application before starting auto-fix.');
      return;
    }
    const steps = (workflow?.steps as WorkflowRole[] | undefined) ?? [];
    const effective = effectiveGoalWorkflowRoles(
      { ...(workflow?.workflow_roles ?? {}) },
      application,
      steps,
    );
    if (!effective.develop) {
      setError('The standard workflow must supply a Development agent before auto-fix can run.');
      return;
    }
    if (steps.includes('deploy') && !effective.deploy) {
      setError('The standard workflow must supply a Deployment agent before auto-fix can run.');
      return;
    }

    const key = `${application.id}:${incident.id}:support`;
    setAutoFixingIncident(key);
    setError(null);
    try {
      const created = await createGoalFromZendesk(
        application.id,
        incident.id,
        effective,
        { workflow_id: workflow.id },
      );
      setGoals((prev) => [created, ...prev.filter((g) => g.id !== created.id)]);
      navigate(goalExecutionPath(created));
      await refreshSelfHealingIncidents(application.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start auto-fix');
    } finally {
      setAutoFixingIncident(null);
    }
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
        e instanceof Error ? e.message : editingApplicationId ? 'Failed to update application' : 'Failed to create application',
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
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete application');
    }
  }

  const unassignedGoals = goals.filter((g) => !g.application_id);
  const isUnassignedRoute = applicationId === APPLICATION_UNASSIGNED_SLUG;
  const currentApp = applicationId && !isUnassignedRoute ? applications.find((a) => a.id === applicationId) : undefined;
  const currentAppGoals = currentApp ? goals.filter((g) => g.application_id === currentApp.id) : [];
  const backlogGoalsCount = currentAppGoals.filter((g) => (g.status ?? 'backlog') === 'backlog').length;
  const inProgressGoalsCount = currentAppGoals.filter((g) => (g.status ?? 'backlog') === 'in_progress').length;
  const completedGoalsCount = currentAppGoals.filter((g) => (g.status ?? 'backlog') === 'done').length;
  const activeRunsCount = currentAppGoals.filter((g) => g.execution_status === 'queued' || g.execution_status === 'running').length;
  const notFound =
    !loading &&
    !!applicationId &&
    !isUnassignedRoute &&
    !currentApp;
  const automaticSelfHealingWorkflow =
    workflowTemplates.find(isStandardWorkflow) ?? (
      workflowTemplates.length === 1 ? workflowTemplates[0] : null
    );

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

  function nextActionHint(app: Application) {
    if (!app.github_repo_url) return 'Link a repository to unlock goal execution and automated fixes.';
    if (!app.description?.trim()) return 'Add a short description so teammates can triage goals faster.';
    if (!app.self_healing_enabled && !app.self_healing_workflow_id) {
      return 'Choose a self-healing strategy to reduce manual recovery work.';
    }
    if (backlogGoalsCount > 0) return 'Move backlog items into progress to keep delivery momentum.';
    return 'System is healthy. Keep an eye on incidents and CI failures.';
  }

  return (
    <div className="page page-applications page-application-detail">
      <div className="page-header page-header-row">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Applications</Link>
            <span aria-hidden="true">/</span>
            <span className="breadcrumb-current">
              {isUnassignedRoute ? 'Unassigned goals' : currentApp?.title ?? 'Application'}
            </span>
          </nav>
          <h1>{isUnassignedRoute ? 'Unassigned goals' : currentApp?.title ?? 'Application'}</h1>
          <p className="muted">
            {isUnassignedRoute
              ? 'Goals without an application. Assign them by moving to an application when you recreate or import.'
              : currentApp?.description?.trim() || 'Add a description so every goal and incident has clear context.'}
          </p>
        </div>
        {!isUnassignedRoute && currentApp && (
          <div className="application-section-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditApplication(currentApp)}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => handleDeleteApplication(currentApp.id, currentApp.title)}
            >
              <TrashIcon />
              Delete
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {appModal}

      {loading ? (
        <div className="empty-state">
          <LoadingIndicator />
        </div>
      ) : notFound ? (
        <section className="card">
          <div className="empty-state">
            <p className="muted">This application does not exist or was deleted.</p>
            <p>
              <Link to="/">Back to applications</Link>
            </p>
          </div>
        </section>
      ) : isUnassignedRoute ? (
        <section className="card application-section application-section-unassigned">
          <div className="application-section-header">
            <div className="application-section-info">
              <h2 className="application-detail-inline-title">Board</h2>
              <p className="application-section-desc muted">
                Goals created before applications were added. Add them to an application by recreating if needed.
              </p>
            </div>
            <span className="card-count">{unassignedGoals.length} goals</span>
          </div>
          <ApplicationKanban
            application={{
              id: '',
              user_id: '',
              title: 'Unassigned',
              description: '',
              github_repo_url: null,
              workflow_roles: {},
              workflow_max_cycles: 3,
              self_healing_enabled: false,
              self_healing_workflow_id: null,
              cloud_infrastructure: [],
              created_at: '',
              updated_at: '',
            }}
            goals={goals}
            scopedGoals={unassignedGoals}
            allowCreate={false}
            onGoalsChange={(updater) => {
              setGoals((prev) => {
                const unassigned = prev.filter((g) => !g.application_id);
                const updated = updater(unassigned);
                const assigned = prev.filter((g) => g.application_id);
                return [...assigned, ...updated];
              });
            }}
            onError={setError}
            onGoalExecuting={openGoalExecution}
            integrations={integrations}
            githubRepoLinked={false}
            workflowTemplates={workflowTemplates}
            onRefreshWorkflowTemplates={refreshWorkflowTemplates}
          />
        </section>
      ) : currentApp ? (
        <section className="card application-section application-main-panel application-detail-shell">
          <div className="application-context-rail" aria-label="Application context">
            <div className="application-context-head">
              <h2>Delivery health</h2>
              <p className="application-section-desc">{nextActionHint(currentApp)}</p>
            </div>

            <div className="application-context-stats" aria-label="Application overview metrics">
              <div className="application-context-stat">
                <span>Backlog</span>
                <strong>{backlogGoalsCount}</strong>
              </div>
              <div className="application-context-stat">
                <span>In progress</span>
                <strong>{inProgressGoalsCount}</strong>
              </div>
              <div className="application-context-stat">
                <span>Completed</span>
                <strong>{completedGoalsCount}</strong>
              </div>
              <div className="application-context-stat">
                <span>Running now</span>
                <strong>{activeRunsCount}</strong>
              </div>
            </div>

            <div className="application-window-tabs application-context-bottom-tabs" role="tablist" aria-label="Application sections">
              <button
                type="button"
                role="tab"
                aria-selected={activeViewTab === 'delivery_goals'}
                className={
                  activeViewTab === 'delivery_goals' ? 'application-window-tab is-active' : 'application-window-tab'
                }
                onClick={() => setActiveViewTab('delivery_goals')}
              >
                Board
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeViewTab === 'self_healing'}
                className={
                  activeViewTab === 'self_healing' ? 'application-window-tab is-active' : 'application-window-tab'
                }
                onClick={() => setActiveViewTab('self_healing')}
              >
                <span>Self-healing</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeViewTab === 'infrastructure'}
                className={
                  activeViewTab === 'infrastructure'
                    ? 'application-window-tab is-active'
                    : 'application-window-tab'
                }
                onClick={() => setActiveViewTab('infrastructure')}
              >
                Infrastructure
              </button>
            </div>
          </div>

          {activeViewTab === 'infrastructure' ? (
            <InfrastructureSection
              key={currentApp.id}
              app={currentApp}
              githubConnected={!!githubConnected}
              githubRepos={githubRepos}
              reposLoadError={reposLoadError}
              saving={savingRepoFor === currentApp.id}
              savingCloudInfrastructure={savingCloudInfrastructureFor === currentApp.id}
              onRepoChange={(url) => handleRepoChange(currentApp.id, url)}
              onSaveCloudInfrastructure={(items) => handleCloudInfrastructureSave(currentApp.id, items)}
            />
          ) : activeViewTab === 'self_healing' ? (
            <SelfHealingSection
              application={currentApp}
              incidents={selfHealingIncidents[currentApp.id] ?? []}
              ciIncidents={selfHealingCiIncidents[currentApp.id] ?? []}
              slaIncidents={selfHealingSlaIncidents[currentApp.id] ?? []}
              securityIssues={selfHealingSecurityIssues[currentApp.id] ?? []}
              goals={goals}
              loadError={selfHealingLoadErrors[currentApp.id] ?? null}
              ciLoadError={selfHealingCiLoadErrors[currentApp.id] ?? null}
              slaLoadError={selfHealingSlaLoadErrors[currentApp.id] ?? null}
              securityLoadError={selfHealingSecurityLoadErrors[currentApp.id] ?? null}
              integrations={integrations}
              workflowTemplates={workflowTemplates}
              saving={savingSelfHealingFor === currentApp.id}
              autoFixingIncidentId={
                autoFixingIncident?.startsWith(`${currentApp.id}:`)
                  ? autoFixingIncident.slice(currentApp.id.length + 1)
                  : null
              }
              onSettingsChange={(aid, updates) => {
                void handleSelfHealingSettingsChange(aid, updates);
              }}
              onAutoFix={(application, incident) => {
                void handleSelfHealingAutoFix(application, incident);
              }}
            />
          ) : (
            <ApplicationKanban
              application={currentApp}
              goals={goals}
              onGoalsChange={setGoals}
              onError={setError}
              onGoalExecuting={openGoalExecution}
              integrations={integrations}
              githubRepoLinked={!!currentApp.github_repo_url}
              workflowTemplates={workflowTemplates}
              onRefreshWorkflowTemplates={refreshWorkflowTemplates}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
