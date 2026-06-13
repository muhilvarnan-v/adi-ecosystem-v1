import { api } from './client';
import type { SelfHealingIncident } from '../types';

export function listSelfHealingIncidents(applicationId: string) {
  return api.get<SelfHealingIncident[]>(
    `/api/applications/${applicationId}/self-healing/incidents`,
  );
}

export function listSelfHealingCiFailures(applicationId: string) {
  return api.get<SelfHealingIncident[]>(
    `/api/applications/${applicationId}/self-healing/ci-failures`,
  );
}

export function listSelfHealingSlaBreaches(applicationId: string) {
  return api.get<SelfHealingIncident[]>(
    `/api/applications/${applicationId}/self-healing/sla-breaches`,
  );
}
