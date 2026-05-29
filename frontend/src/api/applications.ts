import { api } from './client';
import type { Application } from '../types';

export function listApplications() {
  return api.get<Application[]>('/api/applications');
}

export function createApplication(
  title: string,
  description: string,
  githubRepoUrl?: string | null,
) {
  return api.post<Application>('/api/applications', {
    title,
    description,
    github_repo_url: githubRepoUrl || null,
  });
}

export function updateApplication(
  id: string,
  updates: {
    title?: string;
    description?: string;
    github_repo_url?: string | null;
    workflow_roles?: Application['workflow_roles'];
    workflow_max_cycles?: number;
  },
) {
  return api.patch<Application>(`/api/applications/${id}`, updates);
}

export function deleteApplication(id: string) {
  return api.delete(`/api/applications/${id}`);
}
