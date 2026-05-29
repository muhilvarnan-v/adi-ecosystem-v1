import { useEffect, useState } from 'react';
import { listAgents } from '../api/agents';
import type { Agent, Application, WorkflowRole, WorkflowRoles } from '../types';

const DEFAULT_STEPS: WorkflowRole[] = ['develop', 'review', 'test', 'deploy'];

const ROLE_META: { key: WorkflowRole; label: string; hint: string }[] = [
  {
    key: 'develop',
    label: 'Development',
    hint: 'Implements the goal in the repository.',
  },
  {
    key: 'review',
    label: 'Review',
    hint: 'Reviews changes before testing.',
  },
  {
    key: 'test',
    label: 'Test validation',
    hint: 'Runs tests and lint; may loop back to development.',
  },
  {
    key: 'deploy',
    label: 'Deployment',
    hint: 'Opens the pull request when prior phases pass.',
  },
];

interface GoalWorkflowAgentPickerProps {
  application: Application;
  value: WorkflowRoles;
  onChange: (roles: WorkflowRoles) => void;
  /** Phases shown for this goal (from attached workflow or full pipeline). */
  pipelineSteps?: WorkflowRole[];
}

export function GoalWorkflowAgentPicker({
  application,
  value,
  onChange,
  pipelineSteps,
}: GoalWorkflowAgentPickerProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const activeSteps = pipelineSteps?.length ? pipelineSteps : DEFAULT_STEPS;
  const stepSet = new Set<WorkflowRole>(activeSteps);
  const visibleRoles = ROLE_META.filter((m) => stepSet.has(m.key));
  const pipelineLabel = activeSteps.map((p) => ROLE_META.find((m) => m.key === p)?.label ?? p).join(' → ');

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  function setRole(role: keyof WorkflowRoles, agentId: string) {
    const next = { ...value };
    if (agentId) {
      next[role] = agentId;
    } else {
      delete next[role];
    }
    onChange(next);
  }

  const hasWorkflow =
    Boolean(value.develop && value.deploy) ||
    Boolean(application.workflow_roles?.develop && application.workflow_roles?.deploy);

  return (
    <fieldset className="fieldset goal-agent-picker">
      <legend>Agents for this goal</legend>
      <p className="field-hint muted small">
        Pipeline for this goal: <strong>{pipelineLabel}</strong>. Defaults come from the application; empty
        roles inherit application agents when set.
        {hasWorkflow
          ? ' Development and Deployment are required when those phases are in the pipeline.'
          : ' Pick Development and Deployment to enable the multi-agent run.'}
      </p>
      {loading ? (
        <p className="muted small">Loading agents…</p>
      ) : agents.length === 0 ? (
        <p className="muted small">Create agents in Agents and LLM profiles first.</p>
      ) : (
        <div className="goal-agent-picker-grid">
          {visibleRoles.map(({ key, label, hint }) => (
            <label key={key} className="goal-agent-picker-role">
              <span className="goal-agent-picker-role-label">{label}</span>
              <select
                value={value[key] ?? application.workflow_roles?.[key] ?? ''}
                onChange={(e) => setRole(key, e.target.value)}
              >
                <option value="">
                  {application.workflow_roles?.[key] ? 'Use application default' : '— Not assigned —'}
                </option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.display_name}
                  </option>
                ))}
              </select>
              <span className="muted small">{hint}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Effective roles sent to the API (explicit picks only). */
export function effectiveGoalWorkflowRoles(
  picked: WorkflowRoles,
  application: Application,
  pipelineSteps?: WorkflowRole[],
): WorkflowRoles {
  const keys = pipelineSteps?.length ? pipelineSteps : DEFAULT_STEPS;
  const out: WorkflowRoles = {};
  for (const key of keys) {
    const id = (picked[key] ?? application.workflow_roles?.[key] ?? '').trim();
    if (id) out[key] = id;
  }
  return out;
}
