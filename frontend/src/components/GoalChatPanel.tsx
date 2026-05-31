import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { listGoalChat, postGoalChat } from '../api/goals';
import type { GoalChatMessage } from '../types';

interface GoalChatPanelProps {
  goalId: string;
  /** Latest message from the goal execution SSE stream (user or assistant). */
  streamChat?: GoalChatMessage | null;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function GoalChatPanel({ goalId, streamChat }: GoalChatPanelProps) {
  const [messages, setMessages] = useState<GoalChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listGoalChat(goalId);
      setMessages(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chat');
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!streamChat) return;
    setMessages((prev) => {
      if (prev.some((m) => m.id === streamChat.id)) return prev;
      return [...prev, streamChat];
    });
  }, [streamChat]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await postGoalChat(goalId, text);
      setDraft('');
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="goal-chat-panel">
      <p className="muted small goal-chat-intro">
        Messages are saved on this goal. The workflow agents see this thread when a run starts; phase
        summaries are posted here automatically during multi-agent runs.
      </p>
      {error && <div className="alert alert-error goal-chat-alert">{error}</div>}
      <div className="goal-chat-messages" role="log" aria-live="polite">
        {loading && <p className="muted small">Loading conversation…</p>}
        {!loading && messages.length === 0 && (
          <p className="muted small">No messages yet. Ask a question or add constraints for the agents.</p>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            className={`goal-chat-bubble goal-chat-bubble-${m.role === 'user' ? 'user' : 'agent'}`}
          >
            <header className="goal-chat-bubble-meta">
              <span className="goal-chat-role">{m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : 'Agent'}</span>
              <time dateTime={m.created_at}>{formatTime(m.created_at)}</time>
            </header>
            <div className="goal-chat-bubble-body">{m.content}</div>
          </article>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="goal-chat-form" onSubmit={(ev) => void handleSubmit(ev)}>
        <textarea
          id={`goal-chat-input-${goalId}`}
          className="goal-chat-input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Reply to the agents or add context for the next run…"
          disabled={sending}
          maxLength={16000}
          aria-label="Message to agents"
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
