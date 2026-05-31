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
import { listSelfHealingIncidents } from '../api/selfHealing';
import { ExternalLinkIcon, GitHubIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type {
  Application,
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
  GitHubRepoField,
  goalExecutionPath,
  LoadingIndicator,
  repoUrlFor,
} from './applicationSharedUi';

const KANBAN_LANES: { id: GoalStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

type ApplicationViewTab = 'dashboard' | 'self_healing';
type SelfHealingViewTab = 'incidents';

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
  goals,
  loadError,
  integrations,
  workflowTemplates,
  saving,
  autoFixingIncidentId,
  onSettingsChange,
  onAutoFix,
}: {
  application: Application;
  incidents: SelfHealingIncident[];
  goals: Goal[];
  loadError: string | null;
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
  const autoFixDisabled =
    !zendeskConnected ||
    !githubConnected ||
    !application.github_repo_url ||
    missingWorkflow ||
    unknownWorkflow ||
    missingDevelop ||
    missingDeploy;
  const [activeViewTab, setActiveViewTab] = useState<SelfHealingViewTab>('incidents');
  const viewTabs: { id: SelfHealingViewTab; label: string; count: number }[] = [
    { id: 'incidents', label: 'Incidents', count: incidents.length },
  ];
  const autoFixUnavailableReason =
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

  function incidentGoal(incident: SelfHealingIncident): Goal | undefined {
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

  return (
    <section className="self-healing-section" aria-label={`Self-healing for ${application.title}`}>
      {loadError && <p className="alert alert-error">{loadError}</p>}

      <div className="self-healing-simple-header">
        <p className="muted small">
          {application.self_healing_enabled
            ? 'New matching incidents will trigger the standard workflow automatically.'
            : 'New incidents will wait here until you choose Auto fix.'}
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
                    const isFixing = autoFixingIncidentId === incident.id;
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
                              disabled={autoFixDisabled || isFixing}
                              title={autoFixDisabled ? autoFixUnavailableReason : undefined}
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
  jiraIssues,
  jiraSpaces,
  jiraLoadError,
  trelloCards,
  zendeskTickets,
  zendeskLoadError,
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
  jiraIssues: ExternalIssue[];
  jiraSpaces: JiraSpace[];
  jiraLoadError?: string | null;
  trelloCards: ExternalCard[];
  zendeskTickets: ExternalIssue[];
  zendeskLoadError?: string | null;
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

  const jiraConnected = integrations.find((i) => i.provider === 'jira')?.connected;
  const trelloConnected = integrations.find((i) => i.provider === 'trello')?.connected;
  const zendeskConnected = integrations.find((i) => i.provider === 'zendesk')?.connected;

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
          <JiraImportPanel
            issues={jiraIssues}
            spaces={jiraSpaces}
            loadError={jiraLoadError ?? null}
            submitting={submitting}
            importDisabled={!activeWorkflowId}
            onImport={handleImportFromJira}
          />
        )}

        {importTab === 'trello' && (
          <div className="import-list">
            {trelloCards.length === 0 ? (
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
                    disabled={!workflowTemplates.length}
                    title={
                      workflowTemplates.length
                        ? undefined
                        : 'Create a workflow under Workflows before adding goals.'
                    }
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
  const [jiraIssues, setJiraIssues] = useState<ExternalIssue[]>([]);
  const [jiraSpaces, setJiraSpaces] = useState<JiraSpace[]>([]);
  const [jiraLoadError, setJiraLoadError] = useState<string | null>(null);
  const [trelloCards, setTrelloCards] = useState<ExternalCard[]>([]);
  const [zendeskTickets, setZendeskTickets] = useState<ExternalIssue[]>([]);
  const [zendeskLoadError, setZendeskLoadError] = useState<string | null>(null);
  const [selfHealingIncidents, setSelfHealingIncidents] = useState<Record<string, SelfHealingIncident[]>>({});
  const [selfHealingLoadErrors, setSelfHealingLoadErrors] = useState<Record<string, string | null>>({});
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingRepoFor, setSavingRepoFor] = useState<string | null>(null);
  const [savingSelfHealingFor, setSavingSelfHealingFor] = useState<string | null>(null);
  const [autoFixingIncident, setAutoFixingIncident] = useState<string | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<ApplicationViewTab>('dashboard');
  const [showAppModal, setShowAppModal] = useState(false);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [appTitle, setAppTitle] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [appRepoUrl, setAppRepoUrl] = useState('');
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

      const githubOn = integrationsData.find((i) => i.provider === 'github')?.connected;
      const jiraOn = integrationsData.find((i) => i.provider === 'jira')?.connected;
      const trelloOn = integrationsData.find((i) => i.provider === 'trello')?.connected;
      const zendeskOn = integrationsData.find((i) => i.provider === 'zendesk')?.connected;

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

      if (jiraOn) {
        try {
          const [issues, spaces] = await Promise.all([listJiraIssues(), listJiraSpaces()]);
          setJiraIssues(issues);
          setJiraSpaces(spaces);
          setJiraLoadError(null);
        } catch (e) {
          setJiraIssues([]);
          setJiraSpaces([]);
          setJiraLoadError(e instanceof Error ? e.message : 'Failed to load Jira issues');
        }
      } else {
        setJiraIssues([]);
        setJiraSpaces([]);
        setJiraLoadError(null);
      }
      if (trelloOn) {
        try {
          setTrelloCards(await listTrelloCards());
        } catch {
          setTrelloCards([]);
        }
      } else {
        setTrelloCards([]);
      }
      if (zendeskOn) {
        try {
          setZendeskTickets(await listZendeskTickets());
          setZendeskLoadError(null);
        } catch (e) {
          setZendeskTickets([]);
          setZendeskLoadError(e instanceof Error ? e.message : 'Failed to load Zendesk tickets');
        }
      } else {
        setZendeskTickets([]);
        setZendeskLoadError(null);
      }

      const incidentEntries = await Promise.all(
        appsData.map(async (app) => {
          try {
            const incidents = await listSelfHealingIncidents(app.id);
            return [app.id, incidents, null] as const;
          } catch (e) {
            return [
              app.id,
              [] as SelfHealingIncident[],
              e instanceof Error ? e.message : 'Failed to load self-healing incidents',
            ] as const;
          }
        }),
      );
      setSelfHealingIncidents(
        Object.fromEntries(incidentEntries.map(([appId, incidents]) => [appId, incidents])),
      );
      setSelfHealingLoadErrors(
        Object.fromEntries(incidentEntries.map(([appId, , loadError]) => [appId, loadError])),
      );
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
    setActiveViewTab('dashboard');
  }, [applicationId]);

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

    const key = `${application.id}:${incident.id}`;
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

  function goalCountForApp(appId: string) {
    return goals.filter((g) => g.application_id === appId).length;
  }

  const unassignedGoals = goals.filter((g) => !g.application_id);
  const isUnassignedRoute = applicationId === APPLICATION_UNASSIGNED_SLUG;
  const currentApp = applicationId && !isUnassignedRoute ? applications.find((a) => a.id === applicationId) : undefined;
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
              : 'Goal board, imports, and self-healing incidents for this application.'}
          </p>
        </div>
        {!isUnassignedRoute && currentApp && (
          <div className="application-section-actions">
            <span className="card-count">{goalCountForApp(currentApp.id)} goals</span>
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
      {reposLoadError && !error && <div className="alert alert-error">{reposLoadError}</div>}
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
            jiraIssues={jiraIssues}
            jiraSpaces={jiraSpaces}
            jiraLoadError={jiraLoadError}
            trelloCards={trelloCards}
            zendeskTickets={zendeskTickets}
            zendeskLoadError={zendeskLoadError}
            workflowTemplates={workflowTemplates}
            onRefreshWorkflowTemplates={refreshWorkflowTemplates}
          />
        </section>
      ) : currentApp ? (
        <div className="applications-list">
          <section className="card application-section">
            <div className="application-section-header">
              <div className="application-section-info">
                {currentApp.description && (
                  <p className="application-section-desc">{currentApp.description}</p>
                )}
                <ApplicationRepoBar
                  app={currentApp}
                  githubConnected={!!githubConnected}
                  githubRepos={githubRepos}
                  saving={savingRepoFor === currentApp.id}
                  onRepoChange={(url) => handleRepoChange(currentApp.id, url)}
                />
              </div>
            </div>

            <div className="application-window-tabs" role="tablist" aria-label={`${currentApp.title} sections`}>
              <button
                type="button"
                role="tab"
                aria-selected={activeViewTab === 'dashboard'}
                className={
                  activeViewTab === 'dashboard' ? 'application-window-tab is-active' : 'application-window-tab'
                }
                onClick={() => setActiveViewTab('dashboard')}
              >
                Dashboard
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
                <span className="card-count">{(selfHealingIncidents[currentApp.id] ?? []).length}</span>
              </button>
            </div>

            {activeViewTab === 'self_healing' ? (
              <SelfHealingSection
                application={currentApp}
                incidents={selfHealingIncidents[currentApp.id] ?? []}
                goals={goals}
                loadError={selfHealingLoadErrors[currentApp.id] ?? null}
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
                jiraIssues={jiraIssues}
                jiraSpaces={jiraSpaces}
                jiraLoadError={jiraLoadError}
                trelloCards={trelloCards}
                zendeskTickets={zendeskTickets}
                zendeskLoadError={zendeskLoadError}
                workflowTemplates={workflowTemplates}
                onRefreshWorkflowTemplates={refreshWorkflowTemplates}
              />
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
