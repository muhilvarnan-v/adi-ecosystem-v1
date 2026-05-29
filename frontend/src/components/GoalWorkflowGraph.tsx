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

function statusClass(status: string): string {
  if (status === 'passed' || status === 'completed' || status === 'finished') return 'passed';
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function NodeCard({ node }: { node: WorkflowGraphNode }) {
  const color = PHASE_COLORS[node.phase] ?? 'var(--primary)';
  return (
    <div className={`workflow-graph-node workflow-graph-node-${statusClass(node.status)}`}>
      <div className="workflow-graph-node-glow" style={{ background: `radial-gradient(circle at 30% 20%, ${color}55, transparent 65%)` }} />
      <span className="workflow-graph-node-phase" style={{ borderColor: color, color }}>
        {PHASE_LABELS[node.phase] ?? node.phase}
      </span>
      {node.cycle > 0 && <span className="workflow-graph-node-cycle">cycle {node.cycle}</span>}
      <strong className="workflow-graph-node-agent">{node.agent ?? node.role}</strong>
      {node.summary && <p className="workflow-graph-node-summary muted small">{node.summary}</p>}
    </div>
  );
}

export function GoalWorkflowGraph({ graph }: { graph: WorkflowGraph | null }) {
  if (!graph?.nodes?.length) {
    return (
      <p className="muted small workflow-graph-empty">
        The live pipeline graph appears when implementation phases start running.
      </p>
    );
  }

  const ordered = [...graph.nodes].sort((a, b) => {
    const phaseOrder = ['develop', 'review', 'test', 'deploy'];
    const pa = phaseOrder.indexOf(a.phase);
    const pb = phaseOrder.indexOf(b.phase);
    if (pa !== pb) return pa - pb;
    return (a.cycle ?? 0) - (b.cycle ?? 0);
  });

  return (
    <div className="workflow-graph workflow-graph-v2">
      <div className="workflow-graph-panel">
        <div className="workflow-graph-legend">
          {Object.entries(PHASE_LABELS).map(([key, label]) => (
            <span key={key} className="workflow-graph-legend-item">
              <i style={{ background: PHASE_COLORS[key] }} />
              {label}
            </span>
          ))}
        </div>
        <div className="workflow-graph-nodes">
          {ordered.map((node, idx) => {
            const next = ordered[idx + 1];
            return (
              <div key={node.id} className="workflow-graph-lane">
                <NodeCard node={node} />
                {next && (
                  <div className="workflow-graph-connector" aria-hidden>
                    <span className="workflow-graph-connector-line" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="muted small workflow-graph-hint">
          Phases run in order; develop, review, and test may repeat until all pass, then deployment opens the pull
          request.
        </p>
      </div>
    </div>
  );
}
