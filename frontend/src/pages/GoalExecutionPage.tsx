import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listApplications } from '../api/applications';
import { getGoal } from '../api/goals';
import { GoalChatPanel } from '../components/GoalChatPanel';
import { GoalExecutionView } from '../components/GoalExecutionView';
import type { Application, Goal, GoalChatMessage } from '../types';
import {
  APPLICATION_UNASSIGNED_SLUG,
  goalApplicationBoardSlug,
  LoadingIndicator,
} from './applicationSharedUi';

export function GoalExecutionPage() {
  const { goalId: goalIdParam } = useParams<{ goalId: string }>();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamChat, setStreamChat] = useState<GoalChatMessage | null>(null);

  const goalId = useMemo(() => {
    const raw = goalIdParam?.trim() ?? '';
    if (!raw) return '';
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw;
    }
  }, [goalIdParam]);

  const load = useCallback(async () => {
    if (!goalId) {
      setLoading(false);
      setLoadError('Invalid goal link.');
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [g, apps] = await Promise.all([getGoal(goalId), listApplications()]);
      setGoal(g);
      setApplications(apps);
    } catch (e) {
      setGoal(null);
      setLoadError(e instanceof Error ? e.message : 'Failed to load goal');
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setStreamChat(null);
  }, [goal?.id]);

  const boardPath = goal
    ? `/applications/${goalApplicationBoardSlug(goal, undefined)}`
    : '/';

  const appBoardLabel = useMemo(() => {
    if (!goal) return 'Board';
    const slug = goalApplicationBoardSlug(goal, undefined);
    if (slug === APPLICATION_UNASSIGNED_SLUG) return 'Unassigned goals';
    return applications.find((a) => a.id === slug)?.title ?? 'Application';
  }, [goal, applications]);

  return (
    <div className="page page-applications page-goal-execution">
      <div className="page-header page-header-row">
        <div>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Applications</Link>
            <span aria-hidden="true">/</span>
            {goal ? (
              <>
                <Link to={boardPath}>{appBoardLabel}</Link>
                <span aria-hidden="true">/</span>
                <span className="breadcrumb-current">{goal.title}</span>
              </>
            ) : (
              <span className="breadcrumb-current muted">{loading ? 'Loading…' : 'Goal'}</span>
            )}
          </nav>
          <h1>{goal?.title ?? (loading ? 'Goal' : 'Goal not found')}</h1>
          <p className="muted">Agent run, workflow graph, logs, and chat for this goal.</p>
        </div>
      </div>

      {loadError && (
        <div className="alert alert-error">
          {loadError}
          <p className="muted small goal-execution-page-error-back">
            <Link to={boardPath}>Back to board</Link>
          </p>
        </div>
      )}

      {loading && !loadError ? (
        <div className="empty-state">
          <LoadingIndicator />
        </div>
      ) : goal && !loadError ? (
        <div className="goal-execution-page-body">
          <section className="card goal-execution-page-card">
            <GoalExecutionView
              key={goal.id}
              goal={goal}
              onGoalUpdate={setGoal}
              variant="page"
              backTo={boardPath}
              onStreamChat={setStreamChat}
            />
          </section>
          <aside className="card goal-execution-page-chat-card" aria-label="Goal chat">
            <h3 className="goal-execution-chat-heading">Chat</h3>
            <div className="goal-execution-chat-panel-wrap">
              <GoalChatPanel goalId={goal.id} streamChat={streamChat} />
            </div>
          </aside>
        </div>
      ) : !loadError ? (
        <section className="card">
          <div className="empty-state">
            <p className="muted">This goal could not be loaded.</p>
            <p>
              <Link to="/">Back to applications</Link>
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
