import { api } from './client';
import type { LlmProfile, LlmProfileCreatePayload, LlmVendorOption } from '../types';

export function listLlmProfiles() {
  return api.get<LlmProfile[]>('/api/llm-profiles');
}

export function listLlmVendors() {
  return api.get<LlmVendorOption[]>('/api/llm-profiles/options/vendors');
}

export function createLlmProfile(payload: LlmProfileCreatePayload) {
  return api.post<LlmProfile>('/api/llm-profiles', payload);
}

export function updateLlmProfile(id: string, payload: Partial<LlmProfileCreatePayload>) {
  return api.patch<LlmProfile>(`/api/llm-profiles/${id}`, payload);
}

export function deleteLlmProfile(id: string) {
  return api.delete(`/api/llm-profiles/${id}`);
}
