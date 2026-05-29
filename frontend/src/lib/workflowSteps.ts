import type { WorkflowRole } from '../types';

export const DEFAULT_WORKFLOW_STEPS: WorkflowRole[] = ['develop', 'review', 'test', 'deploy'];

const ORDERED: WorkflowRole[] = ['develop', 'review', 'test', 'deploy'];

/** Valid ordered subsequence from develop … deploy (matches backend rules). */
export function normalizeWorkflowSteps(raw: unknown): WorkflowRole[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_WORKFLOW_STEPS];
  const allowed = new Set<string>(ORDERED);
  const seen = new Set<string>();
  const steps: WorkflowRole[] = [];
  for (const item of raw) {
    const s = String(item).trim().toLowerCase();
    if (!allowed.has(s) || seen.has(s)) continue;
    seen.add(s);
    steps.push(s as WorkflowRole);
  }
  if (steps.length === 0) return [...DEFAULT_WORKFLOW_STEPS];
  let j = 0;
  for (const phase of ORDERED) {
    if (j < steps.length && steps[j] === phase) j += 1;
  }
  if (j !== steps.length || steps[0] !== 'develop' || steps[steps.length - 1] !== 'deploy') {
    return [...DEFAULT_WORKFLOW_STEPS];
  }
  return steps;
}

export function buildStepsFromFlags(includeReview: boolean, includeTest: boolean): WorkflowRole[] {
  const s: WorkflowRole[] = ['develop'];
  if (includeReview) s.push('review');
  if (includeTest) s.push('test');
  s.push('deploy');
  return s;
}

export function flagsFromSteps(steps: WorkflowRole[]): { includeReview: boolean; includeTest: boolean } {
  return {
    includeReview: steps.includes('review'),
    includeTest: steps.includes('test'),
  };
}
