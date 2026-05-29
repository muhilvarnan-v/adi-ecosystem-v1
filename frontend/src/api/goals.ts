import { getUserId } from '../lib/user';
import { api } from './client';
import type { Goal, GoalStatus, WorkflowRoles } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export function listGoals(applicationId?: string) {
  const query = applicationId ? `?application_id=${encodeURIComponent(applicationId)}` : '';
  return api.get<Goal[]>(`/api/goals${query}`);
}

export function getGoal(id: string) {
  return api.get<Goal>(`/api/goals/${id}`);
}

export function createGoal(
  applicationId: string,
  title: string,
  description: string,
  workflowRoles: WorkflowRoles | undefined,
  opts: { workflow_id: string },
) {
  return api.post<Goal>('/api/goals', {
    application_id: applicationId,
    title,
    description,
    workflow_roles: workflowRoles ?? {},
    workflow_id: opts.workflow_id.trim(),
  });
}

export type GoalStreamEvent = {
  type: 'log' | 'delta' | 'status' | 'error' | 'complete' | 'done' | 'workflow';
  line?: string;
  text?: string;
  status?: string;
  message?: string;
  pr_url?: string;
  error?: string;
  event?: string;
  phase?: string;
  cycle?: number;
  node_id?: string;
  agent?: string;
  agent_record_id?: string;
  role?: string;
  summary?: string;
  feedback?: string;
  graph?: import('../types').WorkflowGraph;
};

export function streamGoalExecution(
  goalId: string,
  onEvent: (event: GoalStreamEvent) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    const response = await fetch(`${API_BASE}/api/goals/${goalId}/stream`, {
      headers: { 'X-User-Id': getUserId() },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      onEvent({
        type: 'error',
        message: response.statusText || 'Failed to connect to log stream',
      });
      onEvent({ type: 'complete', status: 'failed' });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part
          .split('\n')
          .find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const data = JSON.parse(line.slice(6)) as GoalStreamEvent;
          onEvent(data);
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  })().catch((err) => {
    if (controller.signal.aborted) return;
    onEvent({
      type: 'error',
      message: err instanceof Error ? err.message : 'Stream disconnected',
    });
    onEvent({ type: 'complete', status: 'failed' });
  });

  return () => controller.abort();
}

export function createGoalFromJira(
  applicationId: string,
  issueKey: string,
  workflowRoles: WorkflowRoles | undefined,
  opts: { workflow_id: string },
) {
  return api.post<Goal>('/api/goals/from/jira', {
    application_id: applicationId,
    issue_key: issueKey,
    workflow_roles: workflowRoles ?? {},
    workflow_id: opts.workflow_id.trim(),
  });
}

export function createGoalFromTrello(
  applicationId: string,
  cardId: string,
  workflowRoles: WorkflowRoles | undefined,
  opts: { workflow_id: string },
) {
  return api.post<Goal>('/api/goals/from/trello', {
    application_id: applicationId,
    card_id: cardId,
    workflow_roles: workflowRoles ?? {},
    workflow_id: opts.workflow_id.trim(),
  });
}

export function createGoalFromZendesk(
  applicationId: string,
  ticketId: string,
  workflowRoles: WorkflowRoles | undefined,
  opts: { workflow_id: string },
) {
  return api.post<Goal>('/api/goals/from/zendesk', {
    application_id: applicationId,
    ticket_id: ticketId,
    workflow_roles: workflowRoles ?? {},
    workflow_id: opts.workflow_id.trim(),
  });
}

export function updateGoal(
  id: string,
  updates: { status?: GoalStatus; title?: string; description?: string },
) {
  return api.patch<Goal>(`/api/goals/${id}`, updates);
}

export function resumeGoal(id: string) {
  return api.post<Goal>(`/api/goals/${id}/resume`, {});
}

export function deleteGoal(id: string) {
  return api.delete(`/api/goals/${id}`);
}
