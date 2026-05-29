import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createLlmProfile, deleteLlmProfile, listLlmProfiles, listLlmVendors } from '../api/llmProfiles';
import { LlmIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type { LlmProfile, LlmVendorType } from '../types';

const DEFAULT_BASE_URL = 'https://gap-dev.thoughtworks.net';

function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

export function LlmsPage() {
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [vendorType, setVendorType] = useState<LlmVendorType>('litellm');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [model, setModel] = useState('openai/ai-ops-gemini-2.5-flash');
  const [apiKey, setApiKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfiles(await listLlmProfiles());
      await listLlmVendors();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load LLM profiles');
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
    setDisplayName('');
    setDescription('');
    setBaseUrl(DEFAULT_BASE_URL);
    setModel('openai/ai-ops-gemini-2.5-flash');
    setApiKey('');
    setVendorType('litellm');
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    resetForm();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !baseUrl.trim() || !model.trim() || !apiKey.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createLlmProfile({
        display_name: displayName.trim(),
        description: description.trim(),
        vendor_type: vendorType,
        base_url: baseUrl.trim(),
        model: model.trim(),
        api_key: apiKey.trim(),
      });
      closeCreateModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create LLM profile');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this LLM profile? Agents using it will need a new profile.')) return;
    try {
      await deleteLlmProfile(id);
      setProfiles((items) => items.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete LLM profile');
    }
  }

  const createModal = showCreateModal && (
    <div className="modal-overlay" role="presentation" onClick={closeCreateModal}>
      <div
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-llm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="create-llm-title">Add LLM model</h2>
          <button type="button" className="modal-close" onClick={closeCreateModal} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form">
          <label>
            Vendor type
            <select
              value={vendorType}
              onChange={(e) => setVendorType(e.target.value as LlmVendorType)}
            >
              <option value="litellm">LiteLLM</option>
            </select>
            <span className="field-hint">
              OpenHands agents use LiteLLM for provider-agnostic model routing.
            </span>
          </label>

          {vendorType === 'litellm' && (
            <>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="GAP Gemini Flash"
                  autoFocus
                />
              </label>
              <label>
                Description
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  placeholder="Default coding model for dev agents"
                />
              </label>
              <label>
                LiteLLM base URL
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                  placeholder="https://gap-dev.thoughtworks.net"
                />
              </label>
              <label>
                Model
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="openai/ai-ops-gemini-2.5-flash"
                />
                <span className="field-hint">LiteLLM model id (provider/model)</span>
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  autoComplete="off"
                  placeholder="sk-…"
                />
                <span className="field-hint">
                  Stored securely for agent runs; not shown again after save.
                </span>
              </label>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <PlusIcon />
              {submitting ? 'Saving…' : 'Add model'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>LLM</h1>
        <p className="muted">
          Register LiteLLM gateways (base URL, model, API key). Agents select a profile so OpenHands
          initializes the correct{' '}
          <a href="https://docs.openhands.dev/sdk/arch/llm" target="_blank" rel="noreferrer">
            LLM
          </a>{' '}
          at runtime.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {createModal}

      <section className="card">
        <div className="card-header card-header-actions">
          <div className="card-header-title">
            <h2>Models</h2>
            {!loading && profiles.length > 0 && <span className="card-count">{profiles.length}</span>}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
            <PlusIcon />
            Add model
          </button>
        </div>
        {loading ? (
          <div className="empty-state">
            <LoadingIndicator />
          </div>
        ) : profiles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <LlmIcon />
            </div>
            <p>Add a LiteLLM profile before creating agents.</p>
          </div>
        ) : (
          <ul className="goal-list environment-list">
            {profiles.map((profile) => (
              <li key={profile.id} className="goal-item environment-item">
                <div className="goal-item-header">
                  <h3>{profile.display_name}</h3>
                  <span className="badge badge-manual">{profile.vendor_type}</span>
                </div>
                {profile.description && <p className="goal-desc">{profile.description}</p>}
                <p className="muted small">Base URL: {profile.base_url}</p>
                <p className="muted small">Model: {profile.model}</p>
                <p className="muted small">API key: {profile.api_key_set ? 'Configured' : 'Missing'}</p>
                <div className="goal-meta">
                  <span>Created {new Date(profile.created_at).toLocaleString()}</span>
                </div>
                <div className="goal-actions">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(profile.id)}
                  >
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
