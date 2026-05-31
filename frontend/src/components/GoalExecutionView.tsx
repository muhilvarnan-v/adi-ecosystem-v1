import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { getGoal, resumeGoal, streamGoalExecution, type GoalStreamEvent } from '../api/goals';
import { timelineFromGraph } from '../lib/workflowTimeline';
import type { Goal, GoalChatMessage, WorkflowGraph, WorkflowTimelineEntry } from '../types';
import { GoalChatPanel } from './GoalChatPanel';
import { GoalWorkflowGraph } from './GoalWorkflowGraph';
import { GoalWorkflowTimeline } from './GoalWorkflowTimeline';

export interface GoalExecutionViewProps {
  goal: Goal;
  onGoalUpdate: (goal: Goal) => void;
  variant: 'modal' | 'page';
  /** Required when variant is modal (close button, overlay dismiss, footer). */
  onClose?: () => void;
  /** Required when variant is page — primary navigation back to the goal board. */
  backTo?: string;
  /**
   * When variant is `page`, stream chat events are forwarded here so chat can render
   * outside this component (e.g. a sibling card). Modal variant uses internal state instead.
   */
  onStreamChat?: (message: GoalChatMessage | null) => void;
}

type ViewTab = 'graph' | 'timeline' | 'logs' | 'chat';

function mainTabForPanel(variant: 'modal' | 'page', tab: ViewTab): ViewTab {
  if (variant === 'page' && tab === 'chat') return 'timeline';
  return tab;
}

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
      feedback: patch.feedback,
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
        feedback: event.feedback,
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

type ExecutionLogRow = {
  line: string;
  agent?: string;
  phase?: string;
  cycle?: number;
  event_kind?: string;
  message_role?: string;
  action_type?: string;
  observation_kind?: string;
  body?: string;
};

function executionLogKindLabel(row: ExecutionLogRow): string | null {
  if (row.action_type) return row.action_type;
  if (row.observation_kind) return row.observation_kind;
  if (row.message_role) return `msg:${row.message_role}`;
  if (row.event_kind === 'workflow') return 'workflow';
  if (row.event_kind === 'orchestrator') return 'setup';
  if (row.event_kind === 'llm_message') return 'message';
  if (row.event_kind === 'tool_action') return 'tool';
  if (row.event_kind === 'observation') return 'observe';
  if (row.event_kind) return row.event_kind;
  return null;
}

function GoalLogLine({ row }: { row: ExecutionLogRow }) {
  const kind = executionLogKindLabel(row);
  const text = (row.body && row.body.trim()) || row.line;
  const showBadges = Boolean(
    row.agent || (row.phase && row.phase !== 'goal') || row.cycle != null || kind,
  );

  return (
    <div className="goal-log-row">
      {showBadges ? (
        <div className="goal-log-row-badges">
          {row.agent ? <span className="goal-log-badge goal-log-badge-agent">{row.agent}</span> : null}
          {row.phase && row.phase !== 'goal' ? (
            <span className="goal-log-badge goal-log-badge-phase">{row.phase}</span>
          ) : null}
          {row.cycle != null && row.phase && row.phase !== 'goal' ? (
            <span className="goal-log-badge goal-log-badge-cycle">c{row.cycle}</span>
          ) : null}
          {kind ? <span className="goal-log-badge goal-log-badge-kind">{kind}</span> : null}
        </div>
      ) : null}
      <div className="goal-log-row-text">{text}</div>
    </div>
  );
}

export function GoalExecutionView({
  goal,
  onGoalUpdate,
  variant,
  onClose,
  backTo,
  onStreamChat,
}: GoalExecutionViewProps) {
  const [logRows, setLogRows] = useState<ExecutionLogRow[]>([]);
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
  const [streamChat, setStreamChat] = useState<GoalChatMessage | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const isWorkflow = useMemo(
    () => Boolean(workflowGraph?.nodes?.length || timeline.length > 0),
    [workflowGraph, timeline.length],
  );

  useEffect(() => {
    if (variant === 'page') onStreamChat?.(null);
    else setStreamChat(null);
  }, [goal.id, variant, onStreamChat]);

  useEffect(() => {
    const panelTab = mainTabForPanel(variant, tab);
    if (logRef.current && panelTab === 'logs') {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logRows, tab, variant]);

  const handleResume = useCallback(async () => {
    setResuming(true);
    setError(null);
    setFinished(false);
    setStatus('running');
    setLogRows([{ line: 'Retrying agent run…' }]);
    setTimeline([]);
    if (variant === 'page') onStreamChat?.(null);
    else setStreamChat(null);
    try {
      const updated = await resumeGoal(goal.id);
      setResumable(updated.resumable);
      onGoalUpdate(updated);
      setStreamEpoch((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume goal');
      setResuming(false);
    }
  }, [goal.id, onGoalUpdate, onStreamChat, variant]);

  useEffect(() => {
    if (!goal.workflow_graph?.nodes?.length) return;
    setWorkflowGraph(goal.workflow_graph);
    if (isTerminalExecution(goal.execution_status)) {
      setTimeline(timelineFromGraph(goal.workflow_graph));
    }
  }, [goal.id, goal.workflow_graph, goal.execution_status]);

  useEffect(() => {
    function appendLogRow(row: ExecutionLogRow) {
      setLogRows((prev) => [...prev, row]);
    }

    function handleEvent(event: GoalStreamEvent) {
      applyWorkflowEvent(event, setTimeline, setWorkflowGraph);

      if (event.type === 'log' && event.line) {
        appendLogRow({
          line: event.line,
          agent: event.agent,
          phase: event.phase,
          cycle: event.cycle,
          event_kind: event.event_kind,
          message_role: event.message_role,
          action_type: event.action_type,
          observation_kind: event.observation_kind,
          body: event.body,
        });
      }
      if (event.type === 'delta' && event.text) {
        setLogRows((prev) => {
          if (prev.length === 0) return [{ line: event.text! }];
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, line: last.line + event.text! };
          return next;
        });
      }
      if (event.type === 'status' && event.status) {
        setStatus(event.status);
      }
      if (event.type === 'error' && event.message) {
        setError(event.message);
        appendLogRow({ line: `[error] ${event.message}` });
      }
      if (event.type === 'chat' && event.chat_message) {
        if (variant === 'page') onStreamChat?.(event.chat_message);
        else setStreamChat(event.chat_message);
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
  }, [goal.id, onGoalUpdate, streamEpoch, variant, onStreamChat]);

  const rootClass =
    variant === 'page' ? 'goal-execution-page goal-execution-modal' : 'goal-execution-modal';
  const panelTab = mainTabForPanel(variant, tab);

  const mainTabs = (
    <div className="goal-execution-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={panelTab === 'graph'}
        className={panelTab === 'graph' ? 'active' : ''}
        onClick={() => setTab('graph')}
      >
        Graph
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={panelTab === 'timeline'}
        className={panelTab === 'timeline' ? 'active' : ''}
        onClick={() => setTab('timeline')}
      >
        Timeline
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={panelTab === 'logs'}
        className={panelTab === 'logs' ? 'active' : ''}
        onClick={() => setTab('logs')}
      >
        Logs
      </button>
      {variant === 'modal' && (
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'active' : ''}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
      )}
    </div>
  );

  const mainPanel = (
    <div
      className={
        variant === 'modal' && tab === 'chat'
          ? 'goal-execution-panel goal-execution-panel-chat'
          : variant === 'page'
            ? 'goal-execution-panel goal-execution-page-main-panel'
            : 'goal-execution-panel'
      }
    >
      {panelTab === 'graph' && <GoalWorkflowGraph graph={workflowGraph} />}
      {panelTab === 'timeline' && <GoalWorkflowTimeline entries={timeline} />}
      {panelTab === 'logs' && (
        <div ref={logRef} className="goal-execution-log" aria-live="polite">
          {logRows.length === 0 ? (
            <span className="goal-log-empty">Waiting for agent logs…</span>
          ) : (
            logRows.map((row, i) => <GoalLogLine key={i} row={row} />)
          )}
        </div>
      )}
      {variant === 'modal' && tab === 'chat' && (
        <GoalChatPanel goalId={goal.id} streamChat={streamChat} />
      )}
    </div>
  );

  return (
    <div className={rootClass}>
      {variant === 'modal' && onClose && (
        <div className="modal-header">
          <div>
            <h2 id="goal-execution-title">{goal.title}</h2>
            <p className="muted small goal-execution-subtitle">
              {isWorkflow ? 'Multi-agent workflow' : 'Coding agent'} ·{' '}
              <span className={`execution-status execution-status-${status}`}>{status}</span>
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" title="Close">
            ×
          </button>
        </div>
      )}

      {variant === 'page' && (
        <p className="muted small goal-execution-subtitle goal-execution-page-subtitle">
          {isWorkflow ? 'Multi-agent workflow' : 'Coding agent'} ·{' '}
          <span className={`execution-status execution-status-${status}`}>{status}</span>
        </p>
      )}

      {variant === 'page' ? (
        <>
          {mainTabs}
          {mainPanel}
        </>
      ) : (
        <>
          {mainTabs}
          {mainPanel}
        </>
      )}

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
        {variant === 'modal' && onClose && (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {finished ? 'Close' : 'Run in background'}
          </button>
        )}
        {variant === 'page' && backTo && (
          <Link to={backTo} className="btn btn-primary">
            Back to board
          </Link>
        )}
      </div>
    </div>
  );
}
