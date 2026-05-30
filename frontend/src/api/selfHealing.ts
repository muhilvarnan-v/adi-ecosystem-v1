import { api } from './client';
import type { SelfHealingIncident } from '../types';

export function listSelfHealingIncidents(applicationId: string) {
  return api.get<SelfHealingIncident[]>(
    `/api/applications/${applicationId}/self-healing/incidents`,
  );
}
