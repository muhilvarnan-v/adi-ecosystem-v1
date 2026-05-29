import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createLlmProfile, deleteLlmProfile, listLlmProfiles, listLlmVendors, updateLlmProfile } from '../api/llmProfiles';
import { LlmIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type { LlmProfile, LlmVendorType } from '../types';

const DEFAULT_BASE_URL = 'https://gap-dev.thoughtworks.net/v1';

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
  const [editingId, setEditingId] = useState<string | null>(null);

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
      if (e.key === 'Escape') closeModal();
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

  function closeModal() {
    setShowCreateModal(false);
    setEditingId(null);
    resetForm();
  }

  function openEdit(profile: LlmProfile) {
    setEditingId(profile.id);
    setVendorType(profile.vendor_type);
    setDisplayName(profile.display_name);
    setDescription(profile.description ?? '');
    setBaseUrl(profile.base_url);
    setModel(profile.model);
    setApiKey('');
    setShowCreateModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !baseUrl.trim() || !model.trim()) return;
    if (!editingId && !apiKey.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        const body: Parameters<typeof updateLlmProfile>[1] = {
          display_name: displayName.trim(),
          description: description.trim(),
          base_url: baseUrl.trim(),
          model: model.trim(),
        };
        if (apiKey.trim()) {
          body.api_key = apiKey.trim();
        }
        const updated = await updateLlmProfile(editingId, body);
        setProfiles((items) => items.map((x) => (x.id === editingId ? updated : x)));
      } else {
        await createLlmProfile({
          display_name: displayName.trim(),
          description: description.trim(),
          vendor_type: vendorType,
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_key: apiKey.trim(),
        });
        await load();
      }
      closeModal();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : editingId ? 'Failed to update LLM profile' : 'Failed to create LLM profile',
      );
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
    <div className="modal-overlay" role="presentation" onClick={closeModal}>
      <div
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="llm-modal-title">{editingId ? 'Edit LLM model' : 'Add LLM model'}</h2>
          <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
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
              Coding agents use LiteLLM for provider-agnostic model routing.
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
                  autoFocus={!editingId}
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
                  placeholder="https://your-litellm-host/v1"
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
                  required={!editingId}
                  autoComplete="off"
                  placeholder={editingId ? 'Leave blank to keep existing key' : 'sk-…'}
                />
                <span className="field-hint">
                  {editingId
                    ? 'Only enter a new key when rotating credentials; leave blank to keep the saved key.'
                    : 'Stored securely for agent runs; not shown again after save.'}
                </span>
              </label>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              <PlusIcon />
              {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Add model'}
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
          Register LiteLLM gateways (base URL, model, API key). Agents select a profile so the runtime
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
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(profile)}>
                    Edit
                  </button>
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
