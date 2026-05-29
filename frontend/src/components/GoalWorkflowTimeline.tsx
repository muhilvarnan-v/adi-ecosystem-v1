import type { WorkflowTimelineEntry } from '../types';

const PHASE_LABELS: Record<string, string> = {
  develop: 'Development',
  review: 'Code review',
  test: 'Test validation',
  deploy: 'Deployment',
  cycle: 'Cycle',
};

function statusTone(status?: string): string {
  if (!status) return 'info';
  const s = status.toLowerCase();
  if (s === 'passed' || s === 'completed' || s === 'finished') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'running') return 'running';
  return 'info';
}

export function GoalWorkflowTimeline({ entries }: { entries: WorkflowTimelineEntry[] }) {
  if (!entries.length) {
    return <p className="muted small">No structured workflow events yet.</p>;
  }

  return (
    <div className="workflow-timeline-wrap">
      <ul className="workflow-timeline workflow-timeline-v2">
        {entries.map((entry, idx) => (
          <li
            key={`${entry.nodeId ?? entry.phase}-${entry.cycle}-${idx}`}
            className={`workflow-timeline-item workflow-timeline-${statusTone(entry.status)}`}
          >
            <div className="workflow-timeline-rail" />
            <div className="workflow-timeline-marker" />
            <div className="workflow-timeline-card">
              <div className="workflow-timeline-head">
                <span className="workflow-timeline-phase">
                  {PHASE_LABELS[entry.phase] ?? entry.phase}
                  {entry.cycle ? ` · cycle ${entry.cycle}` : ''}
                </span>
                {entry.agent && <span className="workflow-timeline-agent">{entry.agent}</span>}
                {entry.status && (
                  <span className={`workflow-timeline-pill pill-${statusTone(entry.status)}`}>{entry.status}</span>
                )}
              </div>
              {entry.summary && <p className="workflow-timeline-summary">{entry.summary}</p>}
              {entry.feedback && (
                <p className="workflow-timeline-feedback muted small">{entry.feedback}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
