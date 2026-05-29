import { api } from './client';
import type { WorkflowDefinition } from '../types';

export type UserWorkflowsPayload = {
  workflows: WorkflowDefinition[];
  updated_at?: string | null;
};

export function listWorkflows() {
  return api.get<UserWorkflowsPayload>('/api/workflows');
}

export function saveWorkflows(workflows: WorkflowDefinition[]) {
  return api.put<UserWorkflowsPayload>('/api/workflows', { workflows });
}
