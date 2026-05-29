import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createWorkspace, deleteWorkspace, getWorkspaceConfig, listWorkspaces } from '../api/workspaces';
import { EnvironmentIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type { Environment, SandboxEnvType } from '../types';

const DOCKER_SANDBOX_DOC = 'https://docs.openhands.dev/sdk/guides/agent-server/docker-sandbox';
const API_SANDBOX_DOC = 'https://docs.openhands.dev/sdk/guides/agent-server/api-sandbox';

const DEFAULT_DOCKER_IMAGE = 'ghcr.io/openhands/agent-server:latest-python';

function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

const SANDBOX_TYPE_LABELS: Record<SandboxEnvType, string> = {
  docker: 'Docker',
  remote: 'Remote API',
};

export function WorkspacesPage() {
  const [sandboxes, setSandboxes] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [configPreview, setConfigPreview] = useState<string | null>(null);
  const [previewEnvId, setPreviewEnvId] = useState<string | null>(null);

  const [envId, setEnvId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [sandboxType, setSandboxType] = useState<SandboxEnvType>('docker');
  const [dockerServerImage, setDockerServerImage] = useState(DEFAULT_DOCKER_IMAGE);
  const [dockerHostPort, setDockerHostPort] = useState(3000);
  const [remoteRuntimeApiUrl, setRemoteRuntimeApiUrl] = useState('');
  const [remoteRuntimeApiKey, setRemoteRuntimeApiKey] = useState('');
  const [remoteServerImage, setRemoteServerImage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const envData = await listWorkspaces();
      setSandboxes(envData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sandbox environments');
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
      if (e.key === 'Escape') closeCreateModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showCreateModal]);

  function resetForm() {
    setEnvId('');
    setDisplayName('');
    setDescription('');
    setSandboxType('docker');
    setDockerServerImage(DEFAULT_DOCKER_IMAGE);
    setDockerHostPort(3000);
    setRemoteRuntimeApiUrl('');
    setRemoteRuntimeApiKey('');
    setRemoteServerImage('');
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    resetForm();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!envId.trim() || !displayName.trim()) return;
    if (sandboxType === 'remote') {
      if (!remoteRuntimeApiUrl.trim() || !remoteRuntimeApiKey.trim() || !remoteServerImage.trim()) {
        setError('Remote sandbox requires runtime URL, API key, and server image.');
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      await createWorkspace({
        env_id: envId.trim(),
        display_name: displayName.trim(),
        description: description.trim(),
        sandbox_type: sandboxType,
        docker_server_image: dockerServerImage.trim() || DEFAULT_DOCKER_IMAGE,
        docker_host_port: dockerHostPort,
        remote_runtime_api_url: sandboxType === 'remote' ? remoteRuntimeApiUrl.trim() : '',
        remote_runtime_api_key: sandboxType === 'remote' ? remoteRuntimeApiKey.trim() : '',
        remote_server_image: sandboxType === 'remote' ? remoteServerImage.trim() : '',
        skill_attachments: [],
      });
      closeCreateModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sandbox environment');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this sandbox environment?')) return;
    try {
      await deleteWorkspace(id);
      setSandboxes((items) => items.filter((x) => x.id !== id));
      if (previewEnvId === id) {
        setConfigPreview(null);
        setPreviewEnvId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete sandbox environment');
    }
  }

  async function handlePreviewConfig(env: Environment) {
    setError(null);
    try {
      const result = await getWorkspaceConfig(env.id);
      setConfigPreview(JSON.stringify(result.config, null, 2));
      setPreviewEnvId(env.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config preview');
    }
  }

  const createModal = showCreateModal && (
    <div className="modal-overlay" role="presentation" onClick={closeCreateModal}>
      <div
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-sandbox-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="create-sandbox-title">Create sandbox environment</h2>
          <button type="button" className="modal-close" onClick={closeCreateModal} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form">
          <label>
            Sandbox ID
            <input
              value={envId}
              onChange={(e) => setEnvId(e.target.value.toLowerCase())}
              required
              pattern="[a-z][a-z0-9-]*[a-z0-9]"
              maxLength={63}
              placeholder="my-docker-sandbox"
              title="Lowercase letters, numbers, and hyphens. Must start with a letter."
              autoFocus
            />
            <span className="field-hint">Stable id stored as env_id (referenced by workflows and optional agent links)</span>
          </label>
          <label>
            Display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={200}
              placeholder="Team Docker runtime"
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="OpenHands agent-server reachable on this host port, or hosted runtime API."
            />
          </label>

          <fieldset className="fieldset">
            <legend>Type</legend>
            <p className="field-hint">
              Docker maps to a local{' '}
              <a href={DOCKER_SANDBOX_DOC} target="_blank" rel="noreferrer">
                Docker sandboxed agent server
              </a>
              . Remote maps to{' '}
              <a href={API_SANDBOX_DOC} target="_blank" rel="noreferrer">
                APIRemoteWorkspace
              </a>{' '}
              / hosted runtime.
            </p>
            <label>
              Sandbox type
              <select value={sandboxType} onChange={(e) => setSandboxType(e.target.value as SandboxEnvType)}>
                <option value="docker">Docker</option>
                <option value="remote">Remote</option>
              </select>
            </label>
          </fieldset>

          {sandboxType === 'docker' ? (
            <fieldset className="fieldset">
              <legend>Docker</legend>
              <label>
                Server image
                <input
                  value={dockerServerImage}
                  onChange={(e) => setDockerServerImage(e.target.value)}
                  required
                  maxLength={2000}
                  placeholder={DEFAULT_DOCKER_IMAGE}
                />
                <span className="field-hint">Default matches OpenHands agent-server Python image.</span>
              </label>
              <label>
                Host port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={dockerHostPort}
                  onChange={(e) => setDockerHostPort(Number(e.target.value) || 3000)}
                  required
                />
                <span className="field-hint">Port where the agent-server container is published on the host.</span>
              </label>
            </fieldset>
          ) : (
            <fieldset className="fieldset">
              <legend>Remote runtime</legend>
              <label>
                Runtime API URL
                <input
                  value={remoteRuntimeApiUrl}
                  onChange={(e) => setRemoteRuntimeApiUrl(e.target.value)}
                  required
                  maxLength={2000}
                  placeholder="https://runtime.eval.all-hands.dev"
                />
              </label>
              <label>
                Runtime API key
                <input
                  type="password"
                  value={remoteRuntimeApiKey}
                  onChange={(e) => setRemoteRuntimeApiKey(e.target.value)}
                  required
                  autoComplete="off"
                  maxLength={500}
                  placeholder="RUNTIME_API_KEY"
                />
              </label>
              <label>
                Server image
                <input
                  value={remoteServerImage}
                  onChange={(e) => setRemoteServerImage(e.target.value)}
                  required
                  maxLength={2000}
                  placeholder="ghcr.io/openhands/agent-server:main-python"
                />
                <span className="field-hint">Image the runtime API pulls for the sandboxed agent server.</span>
              </label>
            </fieldset>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <PlusIcon />
              {submitting ? 'Creating…' : 'Create sandbox environment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Sandbox environments</h1>
        <p className="muted">
          Configure where OpenHands runs:{' '}
          <a href={DOCKER_SANDBOX_DOC} target="_blank" rel="noreferrer">
            Docker agent-server
          </a>{' '}
          on your host, or a{' '}
          <a href={API_SANDBOX_DOC} target="_blank" rel="noreferrer">
            hosted runtime API
          </a>
          . After you save a sandbox here, attach it to an implementation{' '}
          <strong>workflow</strong> so goals using that workflow pick up this execution surface.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {createModal}

      <section className="card">
        <div className="card-header card-header-actions">
          <div className="card-header-title">
            <h2>Your sandbox environments</h2>
            {!loading && sandboxes.length > 0 && <span className="card-count">{sandboxes.length}</span>}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
            <PlusIcon />
            Add sandbox
          </button>
        </div>
        {loading ? (
          <div className="empty-state">
            <LoadingIndicator />
          </div>
        ) : sandboxes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <EnvironmentIcon />
            </div>
            <p>No sandbox environments yet.</p>
          </div>
        ) : (
          <ul className="goal-list environment-list">
            {sandboxes.map((env) => (
              <li key={env.id} className="goal-item environment-item">
                <div className="goal-item-header">
                  <h3>{env.display_name}</h3>
                  <span className="badge badge-manual">{SANDBOX_TYPE_LABELS[env.sandbox_type]}</span>
                </div>
                <p className="skill-id muted small">ID: {env.env_id}</p>
                {env.description && <p className="goal-desc">{env.description}</p>}
                {env.sandbox_type === 'docker' ? (
                  <p className="muted small">
                    Image <code>{env.docker_server_image}</code> · host port <strong>{env.docker_host_port}</strong>
                  </p>
                ) : (
                  <p className="muted small">
                    <code>{env.remote_runtime_api_url}</code> · image <code>{env.remote_server_image}</code>
                    {env.remote_runtime_api_key_set ? ' · API key set' : ''}
                  </p>
                )}
                {env.skill_attachments.length > 0 && (
                  <div className="env-skills">
                    <p className="muted small">Legacy mounted skills:</p>
                    <ul className="env-skill-tags">
                      {env.skill_attachments.map((a) => (
                        <li key={a.skill_id} className="env-skill-tag">
                          {a.skill_id}
                          <span className="muted"> → {a.target}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {env.runtime_environment_id && (
                  <p className="muted small">Remote runtime id: {env.runtime_environment_id}</p>
                )}
                <div className="goal-meta">
                  <span>Created {new Date(env.created_at).toLocaleString()}</span>
                </div>
                <div className="goal-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handlePreviewConfig(env)}>
                    View config
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(env.id)}>
                    <TrashIcon />
                    Delete
                  </button>
                </div>
                {previewEnvId === env.id && configPreview && (
                  <pre className="config-preview">{configPreview}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
