import { api } from './client';
import type { McpServer, McpServerCreatePayload } from '../types';

export function listMcpServers() {
  return api.get<McpServer[]>('/api/mcp-servers');
}

export function createMcpServer(payload: McpServerCreatePayload) {
  return api.post<McpServer>('/api/mcp-servers', payload);
}

export function updateMcpServer(id: string, payload: Partial<McpServerCreatePayload>) {
  return api.patch<McpServer>(`/api/mcp-servers/${id}`, payload);
}

export function deleteMcpServer(id: string) {
  return api.delete(`/api/mcp-servers/${id}`);
}
