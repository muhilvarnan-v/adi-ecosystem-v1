import type { WorkflowGraph, WorkflowTimelineEntry } from '../types';

const PHASE_ORDER = ['develop', 'review', 'test', 'deploy'];

function sortNodes(graph: WorkflowGraph) {
  return [...graph.nodes].sort((a, b) => {
    const pa = PHASE_ORDER.indexOf(a.phase);
    const pb = PHASE_ORDER.indexOf(b.phase);
    if (pa !== pb) return pa - pb;
    return (a.cycle ?? 0) - (b.cycle ?? 0);
  });
}

/** Build timeline entries from a persisted workflow graph (e.g. after reload). */
export function timelineFromGraph(graph: WorkflowGraph | null): WorkflowTimelineEntry[] {
  if (!graph?.nodes?.length) return [];

  const entries: WorkflowTimelineEntry[] = [
    { event: 'run_start', phase: 'workflow', cycle: 0, status: 'running' },
  ];

  const seenCycles = new Set<number>();
  for (const node of sortNodes(graph)) {
    const cycle = node.cycle ?? 0;
    if (cycle > 0 && !seenCycles.has(cycle)) {
      seenCycles.add(cycle);
      entries.push({ event: 'cycle_start', phase: 'cycle', cycle, status: 'running' });
    }
    entries.push({
      event: 'phase_start',
      phase: node.phase,
      cycle,
      agent: node.agent ?? undefined,
      status: 'running',
      nodeId: node.id,
    });
    if (node.status && node.status !== 'running') {
      entries.push({
        event: 'phase_end',
        phase: node.phase,
        cycle,
        agent: node.agent ?? undefined,
        status: node.status,
        summary: node.summary ?? undefined,
        nodeId: node.id,
      });
    }
  }
  return entries;
}
