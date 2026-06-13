import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createMcpServer, deleteMcpServer, listMcpServers, updateMcpServer } from '../api/mcpServers';
import { McpIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type { McpServer } from '../types';

type McpTransport = 'http' | 'sse' | 'stdio' | 'manual';

function parseJsonObject(input: string, label: string): Record<string, string> {
  try {
    const parsed = JSON.parse(input || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    const out: Record<string, string> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([k, v]) => {
      const key = String(k).trim();
      const value = String(v ?? '').trim();
      if (key && value) out[key] = value;
    });
    return out;
  } catch {
    throw new Error(`${label} must be valid JSON object`);
  }
}

function parseJsonStringArray(input: string, label: string): string[] {
  try {
    const parsed = JSON.parse(input || '[]');
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array`);
    }
    return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    throw new Error(`${label} must be valid JSON array`);
  }
}

function parseManualConfig(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Manual config must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Manual config must be valid JSON object');
  }
}

function toPrettyJson(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

function mcpTarget(server: McpServer): string {
  if (server.transport === 'stdio') {
    const args = server.args.length > 0 ? ` ${server.args.join(' ')}` : '';
    return `${server.command}${args}`.trim();
  }
  if (server.transport === 'manual') {
    return 'Manual configuration';
  }
  return server.url;
}

function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

export function McpServersPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransport>('http');
  const [url, setUrl] = useState('');
  const [headersJson, setHeadersJson] = useState('{}');
  const [auth, setAuth] = useState('');
  const [command, setCommand] = useState('');
  const [argsJson, setArgsJson] = useState('[]');
  const [envJson, setEnvJson] = useState('{}');
  const [manualConfigJson, setManualConfigJson] = useState('{}');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setServers(await listMcpServers());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!showCreateModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showCreateModal]);

  function resetForm() {
    setName('');
    setTransport('http');
    setUrl('');
    setHeadersJson('{}');
    setAuth('');
    setCommand('');
    setArgsJson('[]');
    setEnvJson('{}');
    setManualConfigJson('{}');
    setDescription('');
  }

  function closeModal() {
    setShowCreateModal(false);
    setEditingId(null);
    resetForm();
  }

  function openEdit(server: McpServer) {
    setEditingId(server.id);
    setName(server.name);
    setTransport(server.transport);
    setUrl(server.url);
    setHeadersJson(toPrettyJson(server.headers ?? {}, '{}'));
    setAuth(server.auth ?? '');
    setCommand(server.command ?? '');
    setArgsJson(toPrettyJson(server.args ?? [], '[]'));
    setEnvJson(toPrettyJson(server.env ?? {}, '{}'));
    setManualConfigJson(toPrettyJson(server.manual_config ?? {}, '{}'));
    setDescription(server.description ?? '');
    setShowCreateModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const trimmedUrl = url.trim();
      const trimmedCommand = command.trim();

      if ((transport === 'http' || transport === 'sse') && !trimmedUrl) {
        throw new Error('Server URL is required for HTTP/SSE transport');
      }
      if (transport === 'stdio' && !trimmedCommand) {
        throw new Error('Command is required for stdio transport');
      }

      const payload = {
        name: name.trim(),
        transport,
        url: transport === 'http' || transport === 'sse' ? trimmedUrl : '',
        headers: transport === 'http' || transport === 'sse' ? parseJsonObject(headersJson, 'Headers') : {},
        auth: transport === 'http' || transport === 'sse' ? auth.trim() : '',
        command: transport === 'stdio' ? trimmedCommand : '',
        args: transport === 'stdio' ? parseJsonStringArray(argsJson, 'Args') : [],
        env: transport === 'stdio' ? parseJsonObject(envJson, 'Environment') : {},
        manual_config: transport === 'manual' ? parseManualConfig(manualConfigJson) : undefined,
        description: description.trim(),
      };

      if (editingId) {
        const updated = await updateMcpServer(editingId, payload);
        setServers((items) => items.map((x) => (x.id === editingId ? updated : x)));
      } else {
        await createMcpServer(payload);
        await load();
      }
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : editingId ? 'Failed to update MCP server' : 'Failed to create MCP server');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this MCP server configuration?')) return;
    try {
      await deleteMcpServer(id);
      setServers((items) => items.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete MCP server');
    }
  }

  const createModal = showCreateModal && (
    <div className="modal-overlay" role="presentation" onClick={closeModal}>
      <div
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="mcp-modal-title">{editingId ? 'Edit MCP server' : 'Add MCP server'}</h2>
          <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="github-tools"
              autoFocus
            />
            <span className="field-hint">Descriptive label for this MCP tool in agent configs</span>
          </label>
          <label>
            Transport mode
            <select value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)}>
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">Stdio</option>
              <option value="manual">Manual JSON</option>
            </select>
            <span className="field-hint">Matches OpenHands MCP transports and manual config mode</span>
          </label>

          {(transport === 'http' || transport === 'sse') && (
            <>
              <label>
                Server URL
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  type="url"
                  maxLength={2000}
                  placeholder="https://mcp.example.com/mcp"
                />
                <span className="field-hint">Remote MCP endpoint URL</span>
              </label>
              <label>
                Auth mode (optional)
                <input
                  value={auth}
                  onChange={(e) => setAuth(e.target.value)}
                  maxLength={200}
                  placeholder="oauth"
                />
                <span className="field-hint">Set <strong>oauth</strong> for OAuth-protected MCP endpoints</span>
              </label>
              <label>
                Headers JSON (optional)
                <textarea
                  value={headersJson}
                  onChange={(e) => setHeadersJson(e.target.value)}
                  rows={4}
                  placeholder={'{\n  "Authorization": "Bearer <token>"\n}'}
                />
                <span className="field-hint">JSON object. Example: Authorization, X-API-Key, etc.</span>
              </label>
            </>
          )}

          {transport === 'stdio' && (
            <>
              <label>
                Command
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  required
                  maxLength={500}
                  placeholder="python"
                />
                <span className="field-hint">Executable to run (for local stdio MCP servers)</span>
              </label>
              <label>
                Args JSON
                <textarea
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  rows={4}
                  placeholder={'[\n  "-m",\n  "my_mcp_server"\n]'}
                />
                <span className="field-hint">JSON array of command arguments</span>
              </label>
              <label>
                Environment JSON (optional)
                <textarea
                  value={envJson}
                  onChange={(e) => setEnvJson(e.target.value)}
                  rows={4}
                  placeholder={'{\n  "API_KEY": "secret123"\n}'}
                />
                <span className="field-hint">JSON object with env vars injected when launching the server</span>
              </label>
            </>
          )}

          {transport === 'manual' && (
            <label>
              Manual MCP server JSON
              <textarea
                value={manualConfigJson}
                onChange={(e) => setManualConfigJson(e.target.value)}
                rows={10}
                placeholder={'{\n  "command": "npx",\n  "args": ["-y", "mcp-remote", "https://mcp.example.com/mcp"]\n}'}
              />
              <span className="field-hint">Advanced mode: this object is used directly as this server entry in mcp.json</span>
            </label>
          )}

          {transport !== 'manual' && (
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="What tools does this server expose?"
              />
            </label>
          )}

          {transport === 'manual' && (
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Optional notes for this manual config"
              />
            </label>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <PlusIcon />
              {submitting ? (editingId ? 'Saving…' : 'Adding…') : editingId ? 'Save changes' : 'Add MCP server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>MCP Servers</h1>
        <p className="muted">
          Configure Model Context Protocol servers in Harness. Attach one or more MCP servers to agents as{' '}
          <code>tools</code> when creating managed agents on Agent Platform.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {createModal}

      <section className="card">
        <div className="card-header card-header-actions">
          <div className="card-header-title">
            <h2>Your MCP servers</h2>
            {!loading && servers.length > 0 && <span className="card-count">{servers.length}</span>}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
            <PlusIcon />
            Add MCP server
          </button>
        </div>
        {loading ? (
          <div className="empty-state">
            <LoadingIndicator />
          </div>
        ) : servers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <McpIcon />
            </div>
            <p>No MCP servers configured yet.</p>
          </div>
        ) : (
          <ul className="goal-list environment-list">
            {servers.map((server) => (
              <li key={server.id} className="goal-item environment-item">
                <div className="goal-item-header">
                  <h3>{server.name}</h3>
                </div>
                <p className="skill-id muted small">[{server.transport.toUpperCase()}] {mcpTarget(server)}</p>
                {server.description && <p className="goal-desc">{server.description}</p>}
                {(server.transport === 'http' || server.transport === 'sse') &&
                  Object.keys(server.headers ?? {}).length > 0 && (
                    <p className="muted small">Headers: {Object.keys(server.headers).join(', ')}</p>
                  )}
                {server.transport === 'stdio' && Object.keys(server.env ?? {}).length > 0 && (
                  <p className="muted small">Env vars: {Object.keys(server.env).join(', ')}</p>
                )}
                <div className="goal-meta">
                  <span>Created {new Date(server.created_at).toLocaleString()}</span>
                </div>
                <div className="goal-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(server)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(server.id)}>
                    <TrashIcon />
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
