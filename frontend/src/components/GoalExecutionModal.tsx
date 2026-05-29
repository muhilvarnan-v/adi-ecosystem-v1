import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getGoal, resumeGoal } from '../api/goals';
import { streamGoalExecution, type GoalStreamEvent } from '../api/goals';
import { timelineFromGraph } from '../lib/workflowTimeline';
import type { Goal, WorkflowGraph, WorkflowTimelineEntry } from '../types';
import { GoalWorkflowGraph } from './GoalWorkflowGraph';
import { GoalWorkflowTimeline } from './GoalWorkflowTimeline';

interface GoalExecutionModalProps {
  goal: Goal;
  onClose: () => void;
  onGoalUpdate: (goal: Goal) => void;
}

type ViewTab = 'graph' | 'timeline' | 'logs';

function isTerminalExecution(status: Goal['execution_status']): boolean {
  return status === 'completed' || status === 'failed';
}

function upsertGraphNode(
  graph: WorkflowGraph | null,
  nodeId: string,
  patch: Partial<WorkflowGraph['nodes'][number]>,
): WorkflowGraph {
  const base: WorkflowGraph = graph ?? { nodes: [], edges: [] };
  const nodes = [...base.nodes];
  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx >= 0) {
    nodes[idx] = { ...nodes[idx], ...patch, id: nodeId };
  } else {
    nodes.push({
      id: nodeId,
      phase: patch.phase ?? 'unknown',
      cycle: patch.cycle ?? 0,
      status: patch.status ?? 'pending',
      agent: patch.agent,
      role: patch.role,
      summary: patch.summary,
    });
  }
  return { nodes, edges: base.edges };
}

function applyWorkflowEvent(
  event: GoalStreamEvent,
  setTimeline: Dispatch<SetStateAction<WorkflowTimelineEntry[]>>,
  setGraph: Dispatch<SetStateAction<WorkflowGraph | null>>,
) {
  if (event.type !== 'workflow') return;

  if (event.graph) {
    setGraph(event.graph);
  }

  if (event.event === 'phase_start' && event.node_id) {
    setGraph((prev) =>
      upsertGraphNode(prev, event.node_id!, {
        phase: event.phase ?? 'unknown',
        cycle: event.cycle ?? 0,
        status: 'running',
        agent: event.agent,
        role: event.role,
      }),
    );
  }

  if (event.event === 'phase_end' && event.node_id) {
    setGraph((prev) =>
      upsertGraphNode(prev, event.node_id!, {
        phase: event.phase ?? 'unknown',
        cycle: event.cycle ?? 0,
        status: event.status ?? 'failed',
        agent: event.agent,
        summary: event.summary,
      }),
    );
  }

  if (event.event === 'phase_start' || event.event === 'phase_end') {
    setTimeline((prev) => [
      ...prev,
      {
        event: event.event!,
        phase: event.phase ?? 'unknown',
        cycle: event.cycle ?? 0,
        agent: event.agent,
        status: event.status,
        summary: event.summary,
        feedback: event.feedback,
        nodeId: event.node_id,
      },
    ]);
  } else if (event.event === 'cycle_start') {
    setTimeline((prev) => [
      ...prev,
      { event: 'cycle_start', phase: 'cycle', cycle: event.cycle ?? 0, status: 'running' },
    ]);
  } else if (event.event === 'run_start') {
    setTimeline((prev) => [
      ...prev,
      { event: 'run_start', phase: 'workflow', cycle: 0, status: 'running' },
    ]);
  } else if (event.event === 'run_end' && event.graph) {
    setGraph(event.graph);
  }
}

export function GoalExecutionModal({ goal, onClose, onGoalUpdate }: GoalExecutionModalProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<string>(goal.execution_status ?? 'starting');
  const [error, setError] = useState<string | null>(goal.execution_error);
  const [prUrl, setPrUrl] = useState<string | null>(goal.pr_url);
  const [resumable, setResumable] = useState(goal.resumable);
  const [finished, setFinished] = useState(() => isTerminalExecution(goal.execution_status));
  const [resuming, setResuming] = useState(false);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const [tab, setTab] = useState<ViewTab>(goal.workflow_graph ? 'graph' : 'timeline');
  const [workflowGraph, setWorkflowGraph] = useState<WorkflowGraph | null>(
    goal.workflow_graph ?? null,
  );
  const [timeline, setTimeline] = useState<WorkflowTimelineEntry[]>(() =>
    isTerminalExecution(goal.execution_status)
      ? timelineFromGraph(goal.workflow_graph ?? null)
      : [],
  );
  const logRef = useRef<HTMLPreElement>(null);

  const isWorkflow = useMemo(
    () => Boolean(workflowGraph?.nodes?.length || timeline.length > 0),
    [workflowGraph, timeline.length],
  );

  useEffect(() => {
    if (logRef.current && tab === 'logs') {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines, tab]);

  const handleResume = useCallback(async () => {
    setResuming(true);
    setError(null);
    setFinished(false);
    setStatus('running');
    setLines(['Retrying agent run…']);
    setTimeline([]);
    try {
      const updated = await resumeGoal(goal.id);
      setResumable(updated.resumable);
      onGoalUpdate(updated);
      setStreamEpoch((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume goal');
      setResuming(false);
    }
  }, [goal.id, onGoalUpdate]);

  useEffect(() => {
    if (!goal.workflow_graph?.nodes?.length) return;
    setWorkflowGraph(goal.workflow_graph);
    if (isTerminalExecution(goal.execution_status)) {
      setTimeline(timelineFromGraph(goal.workflow_graph));
    }
  }, [goal.id, goal.workflow_graph, goal.execution_status]);

  useEffect(() => {
    function appendLine(line: string) {
      setLines((prev) => [...prev, line]);
    }

    function handleEvent(event: GoalStreamEvent) {
      applyWorkflowEvent(event, setTimeline, setWorkflowGraph);

      if (event.type === 'log' && event.line) {
        appendLine(event.line);
      }
      if (event.type === 'delta' && event.text) {
        setLines((prev) => {
          if (prev.length === 0) return [event.text!];
          const next = [...prev];
          next[next.length - 1] = next[next.length - 1] + event.text;
          return next;
        });
      }
      if (event.type === 'status' && event.status) {
        setStatus(event.status);
      }
      if (event.type === 'error' && event.message) {
        setError(event.message);
        appendLine(`[error] ${event.message}`);
      }
      if (event.type === 'complete') {
        setFinished(true);
        setResuming(false);
        if (event.pr_url) setPrUrl(event.pr_url);
        if (event.error) setError(event.error);
        if (event.status) setStatus(event.status);
        getGoal(goal.id)
          .then((g) => {
            setResumable(g.resumable);
            if (g.workflow_graph) {
              setWorkflowGraph(g.workflow_graph);
              setTimeline(timelineFromGraph(g.workflow_graph));
            }
            onGoalUpdate(g);
          })
          .catch(() => undefined);
      }
    }

    const stop = streamGoalExecution(goal.id, handleEvent);
    return stop;
  }, [goal.id, onGoalUpdate, streamEpoch]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal modal-lg goal-execution-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-execution-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="goal-execution-title">{goal.title}</h2>
            <p className="muted small goal-execution-subtitle">
              {isWorkflow ? 'Multi-agent workflow' : 'OpenHands coding agent'} ·{' '}
              <span className={`execution-status execution-status-${status}`}>{status}</span>
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="goal-execution-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'graph'}
            className={tab === 'graph' ? 'active' : ''}
            onClick={() => setTab('graph')}
          >
            Graph
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'timeline'}
            className={tab === 'timeline' ? 'active' : ''}
            onClick={() => setTab('timeline')}
          >
            Timeline
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'logs'}
            className={tab === 'logs' ? 'active' : ''}
            onClick={() => setTab('logs')}
          >
            Logs
          </button>
        </div>

        <div className="goal-execution-panel">
          {tab === 'graph' && <GoalWorkflowGraph graph={workflowGraph} />}
          {tab === 'timeline' && <GoalWorkflowTimeline entries={timeline} />}
          {tab === 'logs' && (
            <pre ref={logRef} className="goal-execution-log" aria-live="polite">
              {lines.length === 0 ? 'Waiting for agent logs…' : lines.join('\n')}
            </pre>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {prUrl && (
          <p className="goal-execution-pr">
            <a href={prUrl} target="_blank" rel="noreferrer">
              View pull request
            </a>
          </p>
        )}

        <div className="modal-actions">
          {resumable && finished && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={resuming}
              onClick={() => void handleResume()}
            >
              {resuming ? 'Retrying…' : 'Retry agent run'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {finished ? 'Close' : 'Run in background'}
          </button>
        </div>
      </div>
    </div>
  );
}
