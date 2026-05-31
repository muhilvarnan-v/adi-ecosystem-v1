import type { WorkflowGraph, WorkflowTimelineEntry } from '../types';

const PHASE_ORDER = ['develop', 'review', 'test', 'deploy'];

/** One UI section (workflow, a single implementation cycle, or deploy). */
export type WorkflowTimelineSection = {
  id: string;
  title: string;
  subtitle?: string;
  entries: WorkflowTimelineEntry[];
};

/**
 * Merge consecutive `phase_start` + `phase_end` rows (same `nodeId`) into a
 * single row so the timeline is not duplicated for every agent run.
 */
export function compactWorkflowTimeline(entries: WorkflowTimelineEntry[]): WorkflowTimelineEntry[] {
  const out: WorkflowTimelineEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    const cur = entries[i];
    const next = entries[i + 1];
    if (
      cur.event === 'phase_start' &&
      next?.event === 'phase_end' &&
      cur.nodeId &&
      next.nodeId === cur.nodeId
    ) {
      out.push({
        ...cur,
        event: 'phase',
        status: next.status ?? cur.status,
        summary: next.summary ?? cur.summary,
        feedback: next.feedback ?? cur.feedback,
      });
      i += 2;
      continue;
    }
    out.push(cur);
    i += 1;
  }
  return out;
}

/**
 * Group compacted entries into workflow → per-cycle (deploy merged into last cycle).
 */
export function groupWorkflowTimeline(entries: WorkflowTimelineEntry[]): WorkflowTimelineSection[] {
  const compacted = compactWorkflowTimeline(entries);
  const workflowE: WorkflowTimelineEntry[] = [];
  const deployE: WorkflowTimelineEntry[] = [];
  const cycleOrder: number[] = [];
  const cycleMap = new Map<number, WorkflowTimelineEntry[]>();

  const ensureCycle = (c: number) => {
    if (!cycleMap.has(c)) {
      cycleOrder.push(c);
      cycleMap.set(c, []);
    }
  };

  for (const e of compacted) {
    if (e.phase === 'workflow') {
      workflowE.push(e);
      continue;
    }
    if (e.phase === 'deploy') {
      deployE.push(e);
      continue;
    }
    const c = e.cycle ?? 0;
    if (e.phase === 'cycle' && e.event === 'cycle_start') {
      ensureCycle(c);
      cycleMap.get(c)!.push(e);
      continue;
    }
    if (c > 0) {
      ensureCycle(c);
      cycleMap.get(c)!.push(e);
    }
  }

  const sections: WorkflowTimelineSection[] = [];
  const lastCycle = cycleOrder.length ? cycleOrder[cycleOrder.length - 1]! : undefined;

  if (workflowE.length) {
    sections.push({
      id: 'workflow',
      title: 'Workflow',
      subtitle: 'Overall run status.',
      entries: workflowE,
    });
  }

  for (const c of cycleOrder) {
    const raw = cycleMap.get(c)!;
    const body = raw.filter((x) => x.phase !== 'cycle');
    const isLast = lastCycle !== undefined && c === lastCycle;
    const cycleEntries = isLast && deployE.length > 0 ? [...body, ...deployE] : body;
    sections.push({
      id: `cycle-${c}`,
      title: `Cycle ${c}`,
      subtitle:
        isLast && deployE.length > 0
          ? 'Develop → review → test; deploy (opens the pull request) follows when this cycle passes all phases.'
          : 'Develop, then review and test. The workflow starts a new cycle if something fails.',
      entries: cycleEntries,
    });
  }

  if (deployE.length > 0 && lastCycle === undefined) {
    sections.push({
      id: 'deploy',
      title: 'Deploy',
      subtitle: 'Opens the pull request.',
      entries: deployE,
    });
  }

  return sections;
}

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
        feedback: node.feedback ?? undefined,
        nodeId: node.id,
      });
    }
  }
  return entries;
}
