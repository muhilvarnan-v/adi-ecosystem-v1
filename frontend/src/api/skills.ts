import { api } from './client';
import type { GitHubRepo, Skill, SkillCreatePayload, SkillFromGitHubPayload } from '../types';

export function listSkills() {
  return api.get<Skill[]>('/api/skills');
}

export function createSkill(payload: SkillCreatePayload) {
  return api.post<Skill>('/api/skills', payload);
}

export function createSkillFromGitHub(payload: SkillFromGitHubPayload) {
  return api.post<Skill>('/api/skills/from/github', payload);
}

export function updateSkill(
  id: string,
  payload: {
    display_name?: string;
    description?: string;
    skill_md?: string;
    additional_files?: { path: string; content: string }[];
  },
) {
  return api.patch<Skill>(`/api/skills/${id}`, payload);
}

export function deleteSkill(id: string) {
  return api.delete(`/api/skills/${id}`);
}

export function listGitHubRepos() {
  return api.get<GitHubRepo[]>('/api/integrations/github/repos');
}
