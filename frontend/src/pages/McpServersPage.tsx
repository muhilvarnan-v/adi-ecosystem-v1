import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createMcpServer, deleteMcpServer, listMcpServers, updateMcpServer } from '../api/mcpServers';
import { McpIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type { McpServer } from '../types';

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
  const [url, setUrl] = useState('');
  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');
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
    setUrl('');
    setHeaderKey('');
    setHeaderValue('');
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
    setUrl(server.url);
    setHeaderKey(server.header_key ?? '');
    setHeaderValue(server.header_value ?? '');
    setDescription(server.description ?? '');
    setShowCreateModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await updateMcpServer(editingId, {
          name: name.trim(),
          url: url.trim(),
          header_key: headerKey.trim(),
          header_value: headerValue.trim(),
          description: description.trim(),
        });
        setServers((items) => items.map((x) => (x.id === editingId ? updated : x)));
      } else {
        await createMcpServer({
          name: name.trim(),
          url: url.trim(),
          header_key: headerKey.trim(),
          header_value: headerValue.trim(),
          description: description.trim(),
        });
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
            Server URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              type="url"
              maxLength={2000}
              placeholder="https://mcp.example.com/sse"
            />
            <span className="field-hint">Remote HTTP gateway URL of the MCP server</span>
          </label>
          <fieldset className="fieldset">
            <legend>Authentication (optional)</legend>
            <label>
              Header key
              <input
                value={headerKey}
                onChange={(e) => setHeaderKey(e.target.value)}
                maxLength={200}
                placeholder="Authorization"
              />
            </label>
            <label>
              Header value
              <input
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                maxLength={2000}
                placeholder="Bearer &lt;token&gt;"
                type="password"
                autoComplete="off"
              />
            </label>
          </fieldset>
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
                <p className="skill-id muted small">{server.url}</p>
                {server.description && <p className="goal-desc">{server.description}</p>}
                {server.header_key && (
                  <p className="muted small">Auth header: {server.header_key}</p>
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
