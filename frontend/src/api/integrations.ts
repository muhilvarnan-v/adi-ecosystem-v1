import { api } from './client';
import type { ExternalCard, ExternalIssue, GitHubRepo, IntegrationStatus, JiraSpace } from '../types';

export function listIntegrations() {
  return api.get<IntegrationStatus[]>('/api/integrations');
}

export function disconnectIntegration(provider: string) {
  return api.delete(`/api/integrations/${provider}`);
}

export async function startJiraOAuth() {
  const { authorize_url } = await api.get<{ authorize_url: string }>('/api/integrations/jira/authorize');
  window.location.href = authorize_url;
}

export async function startTrelloOAuth() {
  const { authorize_url } = await api.get<{ authorize_url: string }>('/api/integrations/trello/authorize');
  window.location.href = authorize_url;
}

export async function startGitHubOAuth() {
  const { authorize_url } = await api.get<{ authorize_url: string }>('/api/integrations/github/authorize');
  window.location.href = authorize_url;
}

export async function startZendeskOAuth(subdomain: string) {
  const query = `?subdomain=${encodeURIComponent(subdomain)}`;
  const { authorize_url } = await api.get<{ authorize_url: string }>(
    `/api/integrations/zendesk/authorize${query}`,
  );
  window.location.href = authorize_url;
}

export function listJiraSpaces() {
  return api.get<JiraSpace[]>('/api/integrations/jira/spaces');
}

export function listJiraIssues(spaceKey?: string) {
  const query = spaceKey ? `?space_key=${encodeURIComponent(spaceKey)}` : '';
  return api.get<ExternalIssue[]>(`/api/integrations/jira/issues${query}`);
}

export function listTrelloCards() {
  return api.get<ExternalCard[]>('/api/integrations/trello/cards');
}

export function listZendeskTickets() {
  return api.get<ExternalIssue[]>('/api/integrations/zendesk/tickets');
}

export function listGitHubRepos() {
  return api.get<GitHubRepo[]>('/api/integrations/github/repos');
}

export function connectCircleCI() {
  return api.post<{ webhook_url: string; setup_note: string }>('/api/integrations/circleci/connect', {});
}

export function connectSLA() {
  return api.post<{ webhook_url: string; setup_note: string }>('/api/integrations/sla/connect', {});
}
