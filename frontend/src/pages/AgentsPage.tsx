import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createAgent,
  deleteAgent,
  getAgentConfig,
  getOpenHandsSchema,
  listAgents,
} from '../api/agents';
import { listWorkspaces } from '../api/workspaces';
import { listLlmProfiles } from '../api/llmProfiles';
import { listMcpServers } from '../api/mcpServers';
import { AgentIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type {
  Agent,
  CriticMode,
  Environment,
  LlmProfile,
  McpServer,
  OpenHandsAgentSchema,
  OpenHandsToolName,
  SecurityAnalyzerType,
} from '../types';

const DEFAULT_TOOLS: OpenHandsToolName[] = ['terminal', 'file_editor', 'task_tracker'];

function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

const emptyForm = () => ({
  agentId: '',
  displayName: '',
  description: '',
  systemPrompt: '',
  environmentId: '',
  llmProfileId: '',
  tools: [...DEFAULT_TOOLS] as OpenHandsToolName[],
  loadProjectSkills: true,
  condenserEnabled: true,
  condenserMaxSize: 240,
  criticEnabled: false,
  criticMode: 'finish_and_message' as CriticMode,
  enableIterativeRefinement: false,
  criticThreshold: 0.6,
  maxRefinementIterations: 3,
  confirmationMode: false,
  securityAnalyzer: 'llm' as SecurityAnalyzerType,
  selectedMcpIds: [] as string[],
});

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [llmProfiles, setLlmProfiles] = useState<LlmProfile[]>([]);
  const [workspaces, setWorkspaces] = useState<Environment[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [schema, setSchema] = useState<OpenHandsAgentSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [configPreview, setConfigPreview] = useState<string | null>(null);
  const [previewAgentId, setPreviewAgentId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const toolOptions =
    schema?.sections.find((s) => s.key === 'tools')?.options ??
    DEFAULT_TOOLS.map((id) => ({ id, label: id, description: '' }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentsData, llmData, envData, mcpData, schemaData] = await Promise.all([
        listAgents(),
        listLlmProfiles(),
        listWorkspaces(),
        listMcpServers(),
        getOpenHandsSchema(),
      ]);
      setAgents(agentsData);
      setLlmProfiles(llmData);
      setWorkspaces(envData);
      setMcpServers(mcpData);
      setSchema(schemaData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
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

  useEffect(() => {
    if (showCreateModal && llmProfiles.length > 0) {
      setForm((f) => ({ ...f, llmProfileId: f.llmProfileId || llmProfiles[0].id }));
    }
  }, [showCreateModal, llmProfiles]);

  function closeCreateModal() {
    setShowCreateModal(false);
    setForm(emptyForm());
  }

  function toggleTool(tool: OpenHandsToolName) {
    setForm((prev) => ({
      ...prev,
      tools: prev.tools.includes(tool)
        ? prev.tools.filter((t) => t !== tool)
        : [...prev.tools, tool],
    }));
  }

  function toggleMcp(id: string) {
    setForm((prev) => ({
      ...prev,
      selectedMcpIds: prev.selectedMcpIds.includes(id)
        ? prev.selectedMcpIds.filter((x) => x !== id)
        : [...prev.selectedMcpIds, id],
    }));
  }

  function llmLabel(profileId: string | null) {
    if (!profileId) return null;
    const p = llmProfiles.find((x) => x.id === profileId);
    return p ? `${p.display_name} (${p.model})` : profileId;
  }

  function envLabel(envRecordId: string | null) {
    if (!envRecordId) return null;
    const env = workspaces.find((e) => e.id === envRecordId);
    return env ? `${env.display_name} (${env.env_id})` : envRecordId;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.agentId.trim() || !form.displayName.trim() || !form.llmProfileId || form.tools.length === 0)
      return;
    setSubmitting(true);
    setError(null);
    try {
      await createAgent({
        agent_id: form.agentId.trim(),
        display_name: form.displayName.trim(),
        description: form.description.trim(),
        system_prompt: form.systemPrompt.trim(),
        environment_id: form.environmentId || null,
        mcp_server_ids: form.selectedMcpIds,
        llm_profile_id: form.llmProfileId,
        tools: form.tools,
        load_project_skills: form.loadProjectSkills,
        condenser_enabled: form.condenserEnabled,
        condenser_max_size: form.condenserMaxSize,
        critic_enabled: form.criticEnabled,
        critic_mode: form.criticMode,
        enable_iterative_refinement: form.enableIterativeRefinement,
        critic_threshold: form.criticThreshold,
        max_refinement_iterations: form.maxRefinementIterations,
        confirmation_mode: form.confirmationMode,
        security_analyzer: form.securityAnalyzer,
      });
      closeCreateModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create agent');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this OpenHands agent profile?')) return;
    try {
      await deleteAgent(id);
      setAgents((items) => items.filter((x) => x.id !== id));
      if (previewAgentId === id) {
        setConfigPreview(null);
        setPreviewAgentId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete agent');
    }
  }

  async function handlePreviewConfig(agent: Agent) {
    setError(null);
    try {
      const result = await getAgentConfig(agent.id);
      setConfigPreview(JSON.stringify(result.config, null, 2));
      setPreviewAgentId(agent.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load OpenHands settings');
    }
  }

  const createModal = showCreateModal && (
    <div className="modal-overlay" role="presentation" onClick={closeCreateModal}>
      <div
        className="modal modal-lg agents-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="create-agent-title">Create OpenHands agent</h2>
          <button type="button" className="modal-close" onClick={closeCreateModal} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form agents-form">
          <section className="agents-form-section">
            <h3>Identity</h3>
            <p className="field-hint muted small">
              Stored in Harness and referenced by implementation workflows (develop, review, test, deploy).
            </p>
            <label>
              Agent ID
              <input
                value={form.agentId}
                onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value.toLowerCase() }))}
                required
                pattern="[a-z][a-z0-9-]*[a-z0-9]"
                maxLength={63}
                placeholder="dev-agent"
                autoFocus
              />
            </label>
            <label>
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                required
                maxLength={200}
                placeholder="Development agent"
              />
            </label>
            <label>
              Description
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={2000}
                placeholder="Implements features on the application repo"
              />
            </label>
          </section>

          <section className="agents-form-section">
            <h3>LLM</h3>
            <p className="field-hint muted small">
              Select a LiteLLM profile from{' '}
              <Link to="/llm">LLM</Link>. Used when OpenHands initializes the agent (
              <code>LLM.model</code>, <code>base_url</code>, <code>api_key</code>).
            </p>
            {llmProfiles.length === 0 ? (
              <p className="alert alert-error">
                No LLM profiles yet. <Link to="/llm">Add a LiteLLM model</Link> first.
              </p>
            ) : (
              <label>
                LLM profile
                <select
                  value={form.llmProfileId}
                  onChange={(e) => setForm((f) => ({ ...f, llmProfileId: e.target.value }))}
                  required
                >
                  <option value="">Select…</option>
                  {llmProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name} — {p.model}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <section className="agents-form-section">
            <h3>System prompt</h3>
            <p className="field-hint muted small">
              Replaces default CodeAct instructions when set (<code>Agent.system_prompt</code>).
            </p>
            <label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                rows={4}
                maxLength={50000}
                placeholder="You are a senior engineer focused on minimal, tested changes…"
              />
            </label>
          </section>

          <section className="agents-form-section">
            <h3>Agent context &amp; skills</h3>
            <p className="field-hint muted small">
              Optional link to a Harness sandbox env record to mount registry skills when that record includes
              skill attachments. OpenHands <strong>execution</strong> (Docker vs remote runtime) is configured on the
              sandbox env and attached to a <Link to="/workflows">workflow</Link>.
            </p>
            <label>
              Sandbox env (optional skills)
              <select
                value={form.environmentId}
                onChange={(e) => setForm((f) => ({ ...f, environmentId: e.target.value }))}
              >
                <option value="">None</option>
                {workspaces.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.display_name} ({env.env_id})
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.loadProjectSkills}
                onChange={(e) => setForm((f) => ({ ...f, loadProjectSkills: e.target.checked }))}
              />
              Load project skills from repo (<code>AgentContext.load_project_skills</code>)
            </label>
          </section>

          <section className="agents-form-section">
            <h3>Tools</h3>
            <p className="field-hint muted small">Built-in tools in the reasoning-action loop.</p>
            <ul className="skill-attach-list">
              {toolOptions.map((tool) => (
                <li key={tool.id}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.tools.includes(tool.id as OpenHandsToolName)}
                      onChange={() => toggleTool(tool.id as OpenHandsToolName)}
                    />
                    <span>
                      <strong>{tool.label}</strong>
                      {tool.description && (
                        <span className="muted small"> — {tool.description}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="agents-form-section">
            <h3>MCP</h3>
            <p className="field-hint muted small">Merged into <code>mcp_config</code> for dynamic tools.</p>
            {mcpServers.length === 0 ? (
              <p className="muted small">No MCP servers configured yet.</p>
            ) : (
              <ul className="skill-attach-list">
                {mcpServers.map((server) => (
                  <li key={server.id}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.selectedMcpIds.includes(server.id)}
                        onChange={() => toggleMcp(server.id)}
                      />
                      <span>
                        <strong>{server.name}</strong>
                        <span className="muted small"> — {server.url}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="agents-form-section">
            <h3>Condenser</h3>
            <p className="field-hint muted small">Compresses event history when context limits are approached.</p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.condenserEnabled}
                onChange={(e) => setForm((f) => ({ ...f, condenserEnabled: e.target.checked }))}
              />
              Enable memory condensation
            </label>
            <label>
              Max events before condensing
              <input
                type="number"
                min={20}
                max={2000}
                value={form.condenserMaxSize}
                onChange={(e) =>
                  setForm((f) => ({ ...f, condenserMaxSize: Number(e.target.value) || 240 }))
                }
                disabled={!form.condenserEnabled}
              />
            </label>
          </section>

          <section className="agents-form-section">
            <h3>Verification &amp; iterative refinement</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.criticEnabled}
                onChange={(e) => setForm((f) => ({ ...f, criticEnabled: e.target.checked }))}
              />
              Enable critic
            </label>
            {form.criticEnabled && (
              <>
                <label>
                  Critic mode
                  <select
                    value={form.criticMode}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, criticMode: e.target.value as CriticMode }))
                    }
                  >
                    <option value="finish_and_message">Finish and message</option>
                    <option value="all_actions">All actions</option>
                  </select>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.enableIterativeRefinement}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, enableIterativeRefinement: e.target.checked }))
                    }
                  />
                  Enable iterative refinement (retry until critic threshold)
                </label>
                {form.enableIterativeRefinement && (
                  <>
                    <label>
                      Critic threshold
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={form.criticThreshold}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, criticThreshold: Number(e.target.value) }))
                        }
                      />
                    </label>
                    <label>
                      Max refinement iterations
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={form.maxRefinementIterations}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            maxRefinementIterations: Number(e.target.value) || 3,
                          }))
                        }
                      />
                    </label>
                  </>
                )}
              </>
            )}
          </section>

          <section className="agents-form-section">
            <h3>Security</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.confirmationMode}
                onChange={(e) => setForm((f) => ({ ...f, confirmationMode: e.target.checked }))}
              />
              Confirmation mode (approve risky actions)
            </label>
            {form.confirmationMode && (
              <label>
                Security analyzer
                <select
                  value={form.securityAnalyzer}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      securityAnalyzer: e.target.value as SecurityAnalyzerType,
                    }))
                  }
                >
                  <option value="llm">LLM security analyzer</option>
                  <option value="none">None</option>
                </select>
              </label>
            )}
          </section>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || form.tools.length === 0 || !form.llmProfileId}
            >
              <PlusIcon />
              {submitting ? 'Creating…' : 'Create agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Agents</h1>
        <p className="muted">
          Configure OpenHands agents for goal and workflow execution: LLM, tools, skills, MCP, condenser,
          critic, and security. Each profile maps to{' '}
          <a href="https://docs.openhands.dev/sdk/guides/agent-settings" target="_blank" rel="noreferrer">
            OpenHandsAgentSettings
          </a>{' '}
          and is used when you assign roles on an application&apos;s implementation workflow.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {createModal}

      <section className="card">
        <div className="card-header card-header-actions">
          <div className="card-header-title">
            <h2>Your agents</h2>
            {!loading && agents.length > 0 && <span className="card-count">{agents.length}</span>}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
            <PlusIcon />
            Add agent
          </button>
        </div>
        {loading ? (
          <div className="empty-state">
            <LoadingIndicator />
          </div>
        ) : agents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <AgentIcon />
            </div>
            <p>No OpenHands agents yet. Create profiles for develop, review, test, and deploy roles.</p>
          </div>
        ) : (
          <ul className="goal-list environment-list">
            {agents.map((agent) => (
              <li key={agent.id} className="goal-item environment-item">
                <div className="goal-item-header">
                  <h3>{agent.display_name}</h3>
                  <span className="badge badge-manual">openhands</span>
                </div>
                <p className="skill-id muted small">ID: {agent.agent_id}</p>
                {agent.description && <p className="goal-desc">{agent.description}</p>}
                {agent.system_prompt && (
                  <p className="goal-desc agent-instruction-preview">{agent.system_prompt}</p>
                )}
                {agent.llm_profile_id && (
                  <p className="muted small">LLM: {llmLabel(agent.llm_profile_id)}</p>
                )}
                {agent.environment_id && (
                  <p className="muted small">Linked sandbox env (skills): {envLabel(agent.environment_id)}</p>
                )}
                {agent.tools.length > 0 && (
                  <div className="env-skills">
                    <p className="muted small">Tools:</p>
                    <ul className="env-skill-tags">
                      {agent.tools.map((t) => (
                        <li key={t} className="env-skill-tag">
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {agent.mcp_server_ids.length > 0 && (
                  <div className="env-skills">
                    <p className="muted small">MCP:</p>
                    <ul className="env-skill-tags">
                      {agent.mcp_server_ids.map((id) => {
                        const mcp = mcpServers.find((s) => s.id === id);
                        return (
                          <li key={id} className="env-skill-tag">
                            {mcp?.name ?? id}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {(agent.critic_enabled || agent.confirmation_mode) && (
                  <p className="muted small">
                    {agent.critic_enabled && 'Critic · '}
                    {agent.enable_iterative_refinement && 'Iterative refinement · '}
                    {agent.confirmation_mode && `Security (${agent.security_analyzer})`}
                  </p>
                )}
                <div className="goal-meta">
                  <span>Created {new Date(agent.created_at).toLocaleString()}</span>
                </div>
                <div className="goal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handlePreviewConfig(agent)}
                  >
                    OpenHands settings
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(agent.id)}>
                    <TrashIcon />
                    Delete
                  </button>
                </div>
                {previewAgentId === agent.id && configPreview && (
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
