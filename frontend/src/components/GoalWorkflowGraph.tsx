import { useEffect, useMemo, useState } from 'react';
import type { WorkflowGraph, WorkflowGraphNode } from '../types';

const PHASE_LABELS: Record<string, string> = {
  develop: 'Develop',
  review: 'Review',
  test: 'Test',
  deploy: 'Deploy',
};

const PHASE_COLORS: Record<string, string> = {
  develop: '#3a6679',
  review: '#007faa',
  test: '#cb8509',
  deploy: '#6b9e78',
};

const PHASE_ORDER = ['develop', 'review', 'test', 'deploy'];

function statusClass(status: string): string {
  if (status === 'passed' || status === 'completed' || status === 'finished') return 'passed';
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function sortPhaseNodes(nodes: WorkflowGraphNode[]) {
  return [...nodes].sort((a, b) => {
    const pa = PHASE_ORDER.indexOf(a.phase);
    const pb = PHASE_ORDER.indexOf(b.phase);
    if (pa === -1 && pb === -1) return 0;
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  });
}

function failureDisplayText(node: WorkflowGraphNode): string | null {
  if (node.status !== 'failed') return null;
  const raw = [node.feedback, node.summary].filter((x): x is string => Boolean(x && String(x).trim()));
  const unique = [...new Set(raw)];
  return unique.length ? unique.join(' — ') : null;
}

function NodeCard({
  node,
  hideCycleBadge,
}: {
  node: WorkflowGraphNode;
  /** When viewing a dedicated cycle tab, the tab already names the cycle. */
  hideCycleBadge?: boolean;
}) {
  const color = PHASE_COLORS[node.phase] ?? 'var(--primary)';
  const failed = node.status === 'failed';
  const failureText = failureDisplayText(node);

  return (
    <div className={`workflow-graph-node workflow-graph-node-${statusClass(node.status)}`}>
      <div
        className="workflow-graph-node-glow"
        style={{ background: `radial-gradient(circle at 30% 20%, ${color}55, transparent 65%)` }}
      />
      <span className="workflow-graph-node-phase" style={{ borderColor: color, color }}>
        {PHASE_LABELS[node.phase] ?? node.phase}
      </span>
      {!hideCycleBadge && node.cycle > 0 && (
        <span className="workflow-graph-node-cycle">cycle {node.cycle}</span>
      )}
      <strong className="workflow-graph-node-agent">{node.agent ?? node.role}</strong>
      {failed && failureText && (
        <div className="workflow-graph-node-failure" role="alert">
          <span className="workflow-graph-node-failure-label">What failed</span>
          <p className="workflow-graph-node-failure-text">{failureText}</p>
        </div>
      )}
      {node.summary && !(failed && failureText) && (
        <p className="workflow-graph-node-summary muted small">{node.summary}</p>
      )}
    </div>
  );
}

function buildPanelNodes(
  cycle: number,
  lastCycle: number | undefined,
  nodesByCycle: Map<number, WorkflowGraphNode[]>,
  deployNodes: WorkflowGraphNode[],
): WorkflowGraphNode[] {
  const base = sortPhaseNodes(nodesByCycle.get(cycle) ?? []);
  if (lastCycle !== undefined && cycle === lastCycle && deployNodes.length > 0) {
    return [...base, ...deployNodes];
  }
  return base;
}

/** Tab color: blue while work is running, green when all steps passed, red if any failed, neutral otherwise. */
type CycleTabTone = 'running' | 'passed' | 'failed' | 'pending';

function cycleTabTone(
  c: number,
  lastCycle: number | undefined,
  nodesByCycle: Map<number, WorkflowGraphNode[]>,
  deployNodes: WorkflowGraphNode[],
): CycleTabTone {
  const cycleNodes = nodesByCycle.get(c) ?? [];
  const withDeploy = lastCycle === c && deployNodes.length > 0;
  const nodes = withDeploy ? [...cycleNodes, ...deployNodes] : [...cycleNodes];
  if (nodes.length === 0) return 'pending';
  const st = (s: string | undefined) => (s ?? '').toLowerCase();
  if (nodes.some((n) => st(n.status) === 'running')) return 'running';
  if (nodes.some((n) => st(n.status) === 'failed')) return 'failed';
  const ok = new Set(['passed', 'completed', 'finished']);
  if (nodes.every((n) => ok.has(st(n.status)))) return 'passed';
  return 'pending';
}

export function GoalWorkflowGraph({ graph }: { graph: WorkflowGraph | null }) {
  const [activeTab, setActiveTab] = useState<number | null>(null);

  const { cycleNumbers, deployNodes, nodesByCycle, lastCycle } = useMemo(() => {
    if (!graph?.nodes?.length) {
      return {
        cycleNumbers: [] as number[],
        deployNodes: [] as WorkflowGraphNode[],
        nodesByCycle: new Map<number, WorkflowGraphNode[]>(),
        lastCycle: undefined as number | undefined,
      };
    }
    const deploy: WorkflowGraphNode[] = [];
    const byCycle = new Map<number, WorkflowGraphNode[]>();
    for (const n of graph.nodes) {
      if (n.phase === 'deploy') {
        deploy.push(n);
        continue;
      }
      const c = n.cycle ?? 0;
      if (c <= 0) continue;
      if (!byCycle.has(c)) byCycle.set(c, []);
      byCycle.get(c)!.push(n);
    }
    const cycleNumbers = [...byCycle.keys()].sort((a, b) => a - b);
    const last = cycleNumbers.length ? cycleNumbers[cycleNumbers.length - 1] : undefined;
    return {
      cycleNumbers,
      deployNodes: sortPhaseNodes(deploy),
      nodesByCycle: byCycle,
      lastCycle: last,
    };
  }, [graph]);

  const runningTab = useMemo((): number | null => {
    if (!graph?.nodes?.length) return null;
    for (const n of graph.nodes) {
      if (n.status === 'running') {
        if (n.phase === 'deploy') return lastCycle ?? 1;
        if ((n.cycle ?? 0) > 0) return n.cycle ?? 1;
      }
    }
    return null;
  }, [graph, lastCycle]);

  const hasCycles = cycleNumbers.length > 0;
  const cycleKey = cycleNumbers.join(',');

  useEffect(() => {
    if (runningTab !== null) {
      setActiveTab(runningTab);
      return;
    }
    setActiveTab((prev) => {
      if (!cycleNumbers.length) return prev ?? 1;
      if (typeof prev === 'number' && cycleNumbers.includes(prev)) return prev;
      return cycleNumbers[cycleNumbers.length - 1]!;
    });
  }, [runningTab, cycleKey, cycleNumbers]);

  if (!graph?.nodes?.length) {
    return (
      <p className="muted small workflow-graph-empty">
        The live pipeline graph appears when implementation phases start running.
      </p>
    );
  }

  if (!hasCycles) {
    if (deployNodes.length > 0) {
      return (
        <div className="workflow-graph workflow-graph-v2 workflow-graph-cycles">
          <div className="workflow-graph-panel">
            <div className="workflow-graph-legend">
              {Object.entries(PHASE_LABELS).map(([key, label]) => (
                <span key={key} className="workflow-graph-legend-item">
                  <i style={{ background: PHASE_COLORS[key] }} />
                  {label}
                </span>
              ))}
            </div>
            <p className="muted small workflow-graph-cycle-panel-caption">Deploy phase</p>
            <div className="workflow-graph-nodes workflow-graph-nodes-horizontal">
              {deployNodes.map((node, idx) => {
                const next = deployNodes[idx + 1];
                return (
                  <div key={node.id} className="workflow-graph-lane">
                    <NodeCard node={node} hideCycleBadge={false} />
                    {next && (
                      <div className="workflow-graph-connector" aria-hidden>
                        <span className="workflow-graph-connector-line" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    return (
      <p className="muted small workflow-graph-empty">
        The live pipeline graph appears when implementation phases start running.
      </p>
    );
  }

  const resolvedTab: number = activeTab ?? cycleNumbers[cycleNumbers.length - 1] ?? 1;
  const panelNodes = buildPanelNodes(resolvedTab, lastCycle, nodesByCycle, deployNodes);

  return (
    <div className="workflow-graph workflow-graph-v2 workflow-graph-cycles">
      <div className="workflow-graph-panel">
        <div className="workflow-graph-legend">
          {Object.entries(PHASE_LABELS).map(([key, label]) => (
            <span key={key} className="workflow-graph-legend-item">
              <i style={{ background: PHASE_COLORS[key] }} />
              {label}
            </span>
          ))}
        </div>

        <p className="muted small workflow-graph-cycle-intro">
          Each <strong>cycle</strong> runs develop → review → test (then <strong>deploy</strong> on the last cycle
          when it passes). Cycle tabs turn <strong>blue</strong> while that cycle is in progress, <strong>green</strong>{' '}
          when every step passed, and <strong>red</strong> if something failed. The graph scrolls horizontally if it
          does not fit.
        </p>

        {hasCycles && (
          <div className="workflow-graph-cycle-tabs" role="tablist" aria-label="Workflow cycle">
            {cycleNumbers.map((c) => {
              const tone = cycleTabTone(c, lastCycle, nodesByCycle, deployNodes);
              const isFinal = lastCycle !== undefined && c === lastCycle;
              return (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={resolvedTab === c}
                  className={`workflow-graph-cycle-tab workflow-graph-cycle-tab--tone-${tone}${isFinal ? ' workflow-graph-cycle-tab--final' : ''}${resolvedTab === c ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(c)}
                >
                  Cycle {c}
                </button>
              );
            })}
          </div>
        )}

        <div className="workflow-graph-cycle-panel" role="tabpanel">
          {lastCycle !== undefined && resolvedTab === lastCycle && deployNodes.length > 0 ? (
            <p className="workflow-graph-cycle-panel-caption muted small">
              Phases for <strong>cycle {resolvedTab}</strong>, then <strong>deploy</strong> (opens the pull request)
              when this cycle completes successfully.
            </p>
          ) : (
            <p className="workflow-graph-cycle-panel-caption muted small">
              Phases in <strong>cycle {resolvedTab}</strong> (in order).
            </p>
          )}

          {panelNodes.length === 0 ? (
            <p className="muted small">No nodes recorded for cycle {resolvedTab} yet.</p>
          ) : (
            <div className="workflow-graph-nodes workflow-graph-nodes-horizontal">
              {panelNodes.map((node, idx) => {
                const next = panelNodes[idx + 1];
                const hideCycle = node.phase !== 'deploy';
                return (
                  <div key={node.id} className="workflow-graph-lane">
                    <NodeCard node={node} hideCycleBadge={hideCycle} />
                    {next && (
                      <div className="workflow-graph-connector" aria-hidden>
                        <span className="workflow-graph-connector-line" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasCycles && cycleNumbers.length > 1 && (
          <p className="muted small workflow-graph-hint workflow-graph-hint-cycles">
            Cycle {cycleNumbers[0]} → cycle {cycleNumbers[cycleNumbers.length - 1]} shows a retry path: the pipeline
            returned to develop after a failed review or test.
          </p>
        )}

        <p className="muted small workflow-graph-hint">
          Phases run in order; develop, review, and test may repeat until all pass, then deployment opens the pull
          request from the last cycle&apos;s tab.
        </p>
      </div>
    </div>
  );
}
