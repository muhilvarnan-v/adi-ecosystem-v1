import { api } from './client';
import type { Environment, EnvironmentConfig, EnvironmentCreatePayload } from '../types';

const BASE = '/api/workspaces';

/** Sandbox environments (Docker / remote OpenHands runtime); stored as environments in Firestore. */
export function listWorkspaces() {
  return api.get<Environment[]>(BASE);
}

export function createWorkspace(payload: EnvironmentCreatePayload) {
  return api.post<Environment>(BASE, payload);
}

export function deleteWorkspace(id: string) {
  return api.delete(`${BASE}/${id}`);
}

export function getWorkspaceConfig(id: string) {
  return api.get<EnvironmentConfig>(`${BASE}/${id}/config`);
}
