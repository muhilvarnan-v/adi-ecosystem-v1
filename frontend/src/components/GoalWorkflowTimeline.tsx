import type { WorkflowTimelineEntry } from '../types';
import { groupWorkflowTimeline } from '../lib/workflowTimeline';

const PHASE_LABELS: Record<string, string> = {
  develop: 'Development',
  review: 'Code review',
  test: 'Test validation',
  deploy: 'Deployment',
  cycle: 'Cycle',
};

function aggregateSectionStatus(entries: WorkflowTimelineEntry[]): string | undefined {
  if (!entries.length) return undefined;
  const normalized = entries.map((e) => (e.status || '').toLowerCase());
  if (normalized.some((s) => s === 'failed')) return 'failed';
  if (normalized.some((s) => s === 'running')) return 'running';
  const pass = new Set(['passed', 'completed', 'finished']);
  if (entries.every((e) => pass.has((e.status || '').toLowerCase()))) return 'passed';
  return undefined;
}

function statusTone(status?: string): string {
  if (!status) return 'info';
  const s = status.toLowerCase();
  if (s === 'passed' || s === 'completed' || s === 'finished') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'running') return 'running';
  return 'info';
}

function TimelineCard({ entry, idx }: { entry: WorkflowTimelineEntry; idx: number }) {
  const phaseLabel = PHASE_LABELS[entry.phase] ?? entry.phase;
  const showCycleInLine = entry.cycle > 0 && entry.phase !== 'cycle' && entry.event !== 'phase';

  return (
    <li
      key={`${entry.nodeId ?? entry.phase}-${entry.cycle}-${entry.event}-${idx}`}
      className={`workflow-timeline-item workflow-timeline-${statusTone(entry.status)}`}
    >
      <div className="workflow-timeline-rail" />
      <div className="workflow-timeline-marker" />
      <div className="workflow-timeline-card">
        <div className="workflow-timeline-head">
          <span className="workflow-timeline-phase">
            {phaseLabel}
            {showCycleInLine ? ` · cycle ${entry.cycle}` : ''}
          </span>
          {entry.agent && <span className="workflow-timeline-agent">{entry.agent}</span>}
          {entry.status && (
            <span className={`workflow-timeline-pill pill-${statusTone(entry.status)}`}>{entry.status}</span>
          )}
        </div>
        {entry.summary && <p className="workflow-timeline-summary">{entry.summary}</p>}
        {entry.feedback && <p className="workflow-timeline-feedback muted small">{entry.feedback}</p>}
      </div>
    </li>
  );
}

export function GoalWorkflowTimeline({ entries }: { entries: WorkflowTimelineEntry[] }) {
  if (!entries.length) {
    return <p className="muted small">No structured workflow events yet.</p>;
  }

  const sections = groupWorkflowTimeline(entries);

  return (
    <div className="workflow-timeline-wrap">
      <p className="muted small workflow-timeline-intro">
        Events are grouped by cycle. Deploy appears at the end of the <strong>last cycle</strong> group. Each agent
        step shows one row when finished (start and end combined).
      </p>
      <div className="workflow-timeline-sections">
        {sections.map((section) => {
          const sectionStatus = aggregateSectionStatus(section.entries);
          const includesDeploy = section.entries.some((e) => e.phase === 'deploy');
          return (
            <section
              key={section.id}
              className={`workflow-timeline-section${includesDeploy ? ' workflow-timeline-section-includes-deploy' : ''}`}
              aria-labelledby={`timeline-${section.id}`}
            >
              <header className="workflow-timeline-section-header">
                <h4 className="workflow-timeline-section-title" id={`timeline-${section.id}`}>
                  {section.title}
                  {sectionStatus && (
                    <span className={`workflow-timeline-section-badge pill-${statusTone(sectionStatus)}`}>
                      {sectionStatus}
                    </span>
                  )}
                </h4>
                {section.subtitle && (
                  <p className="workflow-timeline-section-subtitle muted small">{section.subtitle}</p>
                )}
              </header>
              <ul className="workflow-timeline workflow-timeline-v2 workflow-timeline-nested">
                {section.entries.map((entry, idx) => (
                  <TimelineCard
                    key={`${section.id}-${entry.nodeId ?? entry.phase}-${entry.event}-${idx}`}
                    entry={entry}
                    idx={idx}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
