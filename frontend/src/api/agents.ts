import { api } from './client';
import type { Agent, AgentConfig, AgentCreatePayload, OpenHandsAgentSchema } from '../types';

export function listAgents() {
  return api.get<Agent[]>('/api/agents');
}

export function getOpenHandsSchema() {
  return api.get<OpenHandsAgentSchema>('/api/agents/openhands/schema');
}

export function createAgent(payload: AgentCreatePayload) {
  return api.post<Agent>('/api/agents', payload);
}

export function deleteAgent(id: string) {
  return api.delete(`/api/agents/${id}`);
}

export function getAgentConfig(id: string) {
  return api.get<AgentConfig>(`/api/agents/${id}/config`);
}
