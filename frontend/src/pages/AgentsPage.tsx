import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createAgent,
  deleteAgent,
  getAgentConfig,
  getOpenHandsSchema,
  listAgents,
  updateAgent,
} from '../api/agents';
import { listSkills } from '../api/skills';
import { listLlmProfiles } from '../api/llmProfiles';
import { listMcpServers } from '../api/mcpServers';
import { AgentIcon, PlusIcon, TrashIcon } from '../components/Icons';
import type {
  Agent,
  CriticMode,
  LlmProfile,
  McpServer,
  OpenHandsAgentSchema,
  OpenHandsToolName,
  SecurityAnalyzerType,
  Skill,
} from '../types';

const DEFAULT_SKILL_TARGET = '/.agent/skills/';

const DEFAULT_TOOLS: OpenHandsToolName[] = ['terminal', 'file_editor', 'task_tracker'];

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function displayInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1][0];
    return `${a}${b}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

function mcpSummary(server: McpServer): string {
  if (server.transport === 'stdio') {
    const args = server.args.length > 0 ? ` ${server.args.join(' ')}` : '';
    return `[STDIO] ${`${server.command}${args}`.trim()}`;
  }
  if (server.transport === 'manual') {
    return '[MANUAL] custom JSON config';
  }
  return `[${server.transport.toUpperCase()}] ${server.url}`;
}

const emptyForm = () => ({
  displayName: '',
  description: '',
  systemPrompt: '',
  llmProfileId: '',
  tools: [...DEFAULT_TOOLS] as OpenHandsToolName[],
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
  attachedSkillIds: [] as string[],
  load_project_skills: true,
});

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [llmProfiles, setLlmProfiles] = useState<LlmProfile[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [schema, setSchema] = useState<OpenHandsAgentSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [detailsAgentId, setDetailsAgentId] = useState<string | null>(null);
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
      const [agentsData, llmData, mcpData, skillsData, schemaData] = await Promise.all([
        listAgents(),
        listLlmProfiles(),
        listMcpServers(),
        listSkills(),
        getOpenHandsSchema(),
      ]);
      setAgents(agentsData);
      setLlmProfiles(llmData);
      setMcpServers(mcpData);
      setSkills(skillsData);
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
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showCreateModal]);

  useEffect(() => {
    if (!detailsAgentId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDetailsModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [detailsAgentId]);

  useEffect(() => {
    if (detailsAgentId && !agents.some((a) => a.id === detailsAgentId)) {
      closeDetailsModal();
    }
  }, [agents, detailsAgentId]);

  useEffect(() => {
    if (showCreateModal && !editingAgentId && llmProfiles.length > 0) {
      setForm((f) => ({ ...f, llmProfileId: f.llmProfileId || llmProfiles[0].id }));
    }
  }, [showCreateModal, editingAgentId, llmProfiles]);

  function closeModal() {
    setShowCreateModal(false);
    setEditingAgentId(null);
    setForm(emptyForm());
  }

  function openEditAgent(agent: Agent) {
    setEditingAgentId(agent.id);
    setForm({
      displayName: agent.display_name,
      description: agent.description,
      systemPrompt: agent.system_prompt,
      llmProfileId: agent.llm_profile_id || '',
      tools: (agent.tools.length ? agent.tools : [...DEFAULT_TOOLS]) as OpenHandsToolName[],
      condenserEnabled: agent.condenser_enabled,
      condenserMaxSize: agent.condenser_max_size,
      criticEnabled: agent.critic_enabled,
      criticMode: agent.critic_mode,
      enableIterativeRefinement: agent.enable_iterative_refinement,
      criticThreshold: agent.critic_threshold,
      maxRefinementIterations: agent.max_refinement_iterations,
      confirmationMode: agent.confirmation_mode,
      securityAnalyzer: agent.security_analyzer,
      selectedMcpIds: [...agent.mcp_server_ids],
      attachedSkillIds: (agent.skill_attachments ?? []).map((a) => a.skill_id),
      load_project_skills: agent.load_project_skills,
    });
    setShowCreateModal(true);
  }

  function closeDetailsModal() {
    setDetailsAgentId(null);
    setConfigPreview(null);
    setPreviewAgentId(null);
  }

  function openDetails(agentId: string) {
    setDetailsAgentId(agentId);
    setConfigPreview(null);
    setPreviewAgentId(null);
  }

  function toggleTool(tool: OpenHandsToolName) {
    setForm((prev) => ({
      ...prev,
      tools: prev.tools.includes(tool)
        ? prev.tools.filter((t) => t !== tool)
        : [...prev.tools, tool],
    }));
  }

  function toggleAttachedSkill(skillId: string) {
    setForm((prev) => ({
      ...prev,
      attachedSkillIds: prev.attachedSkillIds.includes(skillId)
        ? prev.attachedSkillIds.filter((x) => x !== skillId)
        : [...prev.attachedSkillIds, skillId],
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.displayName.trim() || !form.llmProfileId || form.tools.length === 0)
      return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        display_name: form.displayName.trim(),
        description: form.description.trim(),
        system_prompt: form.systemPrompt.trim(),
        environment_id: null,
        skill_attachments: form.attachedSkillIds.map((skill_id) => ({
          skill_id,
          target: DEFAULT_SKILL_TARGET,
        })),
        mcp_server_ids: form.selectedMcpIds,
        llm_profile_id: form.llmProfileId,
        tools: form.tools,
        load_project_skills: form.load_project_skills,
        condenser_enabled: form.condenserEnabled,
        condenser_max_size: form.condenserMaxSize,
        critic_enabled: form.criticEnabled,
        critic_mode: form.criticMode,
        enable_iterative_refinement: form.enableIterativeRefinement,
        critic_threshold: form.criticThreshold,
        max_refinement_iterations: form.maxRefinementIterations,
        confirmation_mode: form.confirmationMode,
        security_analyzer: form.securityAnalyzer,
      };
      if (editingAgentId) {
        const updated = await updateAgent(editingAgentId, body);
        setAgents((prev) => prev.map((a) => (a.id === editingAgentId ? updated : a)));
      } else {
        await createAgent(body);
        await load();
      }
      closeModal();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : editingAgentId ? 'Failed to update agent' : 'Failed to create agent',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent profile?')) return;
    try {
      await deleteAgent(id);
      setAgents((items) => items.filter((x) => x.id !== id));
      if (detailsAgentId === id) {
        closeDetailsModal();
      } else if (previewAgentId === id) {
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
      setError(e instanceof Error ? e.message : 'Failed to load agent settings');
    }
  }

  const detailAgent = detailsAgentId ? agents.find((a) => a.id === detailsAgentId) ?? null : null;

  const detailsModal = detailAgent && (
    <div className="modal-overlay" role="presentation" onClick={closeDetailsModal}>
      <div
        className="modal modal-lg agents-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header agents-detail-modal-header">
          <div className="agents-detail-modal-title-block">
            <h2 id="agent-detail-title">{detailAgent.display_name}</h2>
          </div>
          <button type="button" className="modal-close" onClick={closeDetailsModal} aria-label="Close">
            ×
          </button>
        </div>

        <div className="agents-detail-body">
          {detailAgent.description ? (
            <section className="agents-detail-section">
              <h3>Description</h3>
              <p className="agents-detail-text">{detailAgent.description}</p>
            </section>
          ) : null}

          {detailAgent.system_prompt ? (
            <section className="agents-detail-section">
              <h3>System prompt</h3>
              <pre className="agents-detail-pre">{detailAgent.system_prompt}</pre>
            </section>
          ) : null}

          <section className="agents-detail-section">
            <h3>Skills</h3>
            <dl className="agents-detail-dl">
              <div>
                <dt>Harness skills</dt>
                <dd>
                  {(detailAgent.skill_attachments ?? []).length === 0 ? (
                    '—'
                  ) : (
                    <ul className="agents-detail-tags">
                      {(detailAgent.skill_attachments ?? []).map((a) => {
                        const sk = skills.find((s) => s.skill_id === a.skill_id);
                        return (
                          <li key={a.skill_id}>
                            {sk ? `${sk.display_name} (${a.skill_id})` : a.skill_id}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="agents-detail-section">
            <h3>Tools</h3>
            {detailAgent.tools.length === 0 ? (
              <p className="muted small">None</p>
            ) : (
              <ul className="agents-detail-tags">
                {detailAgent.tools.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="agents-detail-section">
            <h3>MCP servers</h3>
            {detailAgent.mcp_server_ids.length === 0 ? (
              <p className="muted small">None</p>
            ) : (
              <ul className="agents-detail-tags agents-detail-tags--mcp">
                {detailAgent.mcp_server_ids.map((id) => {
                  const mcp = mcpServers.find((s) => s.id === id);
                  return <li key={id}>{mcp ? `${mcp.name} (${mcpSummary(mcp)})` : id}</li>;
                })}
              </ul>
            )}
          </section>

          <section className="agents-detail-section">
            <h3>Memory (condenser)</h3>
            <dl className="agents-detail-dl">
              <div>
                <dt>Enabled</dt>
                <dd>{detailAgent.condenser_enabled ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Max events before condensing</dt>
                <dd>{detailAgent.condenser_max_size}</dd>
              </div>
            </dl>
          </section>

          <section className="agents-detail-section">
            <h3>Critic &amp; refinement</h3>
            <dl className="agents-detail-dl">
              <div>
                <dt>Critic enabled</dt>
                <dd>{detailAgent.critic_enabled ? 'Yes' : 'No'}</dd>
              </div>
              {detailAgent.critic_enabled && (
                <>
                  <div>
                    <dt>Critic mode</dt>
                    <dd>{detailAgent.critic_mode}</dd>
                  </div>
                  <div>
                    <dt>Iterative refinement</dt>
                    <dd>{detailAgent.enable_iterative_refinement ? 'Yes' : 'No'}</dd>
                  </div>
                  {detailAgent.enable_iterative_refinement && (
                    <>
                      <div>
                        <dt>Critic threshold</dt>
                        <dd>{detailAgent.critic_threshold}</dd>
                      </div>
                      <div>
                        <dt>Max refinement iterations</dt>
                        <dd>{detailAgent.max_refinement_iterations}</dd>
                      </div>
                    </>
                  )}
                </>
              )}
            </dl>
          </section>

          <section className="agents-detail-section">
            <h3>Security</h3>
            <dl className="agents-detail-dl">
              <div>
                <dt>Confirmation mode</dt>
                <dd>{detailAgent.confirmation_mode ? 'Yes' : 'No'}</dd>
              </div>
              {detailAgent.confirmation_mode && (
                <div>
                  <dt>Security analyzer</dt>
                  <dd>{detailAgent.security_analyzer}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="agents-detail-section">
            <h3>Record</h3>
            <p className="muted small">Updated {new Date(detailAgent.updated_at).toLocaleString()}</p>
          </section>

          <section className="agents-detail-section">
            <h3>Agent settings (JSON)</h3>
            <p className="field-hint muted small">
              Resolved config sent to the coding agent for this agent profile.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handlePreviewConfig(detailAgent)}
            >
              {previewAgentId === detailAgent.id && configPreview ? 'Reload JSON' : 'Load JSON'}
            </button>
            {previewAgentId === detailAgent.id && configPreview && (
              <pre className="config-preview agents-detail-json">{configPreview}</pre>
            )}
          </section>
        </div>

        <div className="modal-actions agents-detail-actions">
          <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(detailAgent.id)}>
            <TrashIcon />
            Delete agent
          </button>
          <button type="button" className="btn btn-secondary" onClick={closeDetailsModal}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  const createModal = showCreateModal && (
    <div className="modal-overlay" role="presentation" onClick={closeModal}>
      <div
        className="modal modal-lg agents-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="agent-form-title">{editingAgentId ? 'Edit agent' : 'Create agent'}</h2>
          <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form agents-form">
          <section className="agents-form-section">
            <h3>Identity</h3>
            <p className="field-hint muted small">
              {editingAgentId ? (
                <>
                  Agent ID <code>{agents.find((a) => a.id === editingAgentId)?.agent_id}</code> is fixed for
                  workflow references.
                </>
              ) : (
                <>
                  A unique agent ID is assigned when you create the profile. It is stored in Harness and can be
                  referenced by implementation workflows (develop, review, test, deploy).
                </>
              )}
            </p>
            <label>
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                required
                maxLength={200}
                placeholder="Development agent"
                autoFocus={!editingAgentId}
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
              <Link to="/llm">LLM</Link>. Used when the runtime initializes the agent (
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
                      {p.display_name}
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
            <h3>Skills</h3>
            <p className="field-hint muted small">
              The <Link to="/workflows">workflow</Link> decides where the agent runs. Checked skills are copied
              into the repository for each run so the agent can follow them. Manage skills under{' '}
              <Link to="/harness/skills">Harness → Skills</Link>.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.load_project_skills}
                onChange={(e) => setForm((f) => ({ ...f, load_project_skills: e.target.checked }))}
              />
              Load project skills from the repository at runtime
            </label>
            {skills.length === 0 ? (
              <p className="muted small">
                No skills yet. <Link to="/harness/skills">Add skills</Link> to attach them here.
              </p>
            ) : (
              <ul className="skill-attach-list">
                {skills.map((s) => (
                  <li key={s.id}>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.attachedSkillIds.includes(s.skill_id)}
                        onChange={() => toggleAttachedSkill(s.skill_id)}
                      />
                      <span>
                        <strong>{s.display_name}</strong>
                        <span className="muted small"> ({s.skill_id})</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
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
                        <span className="muted small"> — {mcpSummary(server)}</span>
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

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || form.tools.length === 0 || !form.llmProfileId}
            >
              <PlusIcon />
              {submitting ? 'Saving…' : editingAgentId ? 'Save changes' : 'Create agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="page agents-page">
      <div className="page-header">
        <h1>Agents</h1>
        <p className="muted">
          Configure coding agents for goal and workflow execution: LLM, tools, skills, MCP, condenser,
          critic, and security. Each profile maps to{' '}
          <a href="https://docs.openhands.dev/sdk/guides/agent-settings" target="_blank" rel="noreferrer">
            SDK agent settings
          </a>{' '}
          and is used when you assign roles on an application&apos;s implementation workflow.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {createModal}
      {detailsModal}

      <section className="card agents-roster-card">
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
          <ul className="agents-grid agents-grid--skeleton" aria-busy="true" aria-label="Loading agents">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="agent-card-skeleton" />
            ))}
          </ul>
        ) : agents.length === 0 ? (
          <div className="empty-state agents-empty">
            <div className="agents-empty-orbit" aria-hidden>
              <div className="agents-empty-orbit-ring" />
              <div className="empty-state-icon agents-empty-icon">
                <AgentIcon />
              </div>
            </div>
            <p className="agents-empty-title">No agents yet</p>
            <p className="agents-empty-copy muted">
              Create agent profiles for develop, review, test, and deploy—each with its own LLM, tools, and
              optional skills.
            </p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
              <PlusIcon />
              Create your first agent
            </button>
          </div>
        ) : (
          <ul className="agents-grid">
            {agents.map((agent, index) => {
              const theme = stableHash(agent.id) % 4;
              const summaryBits: string[] = [];
              if (agent.tools.length > 0) {
                summaryBits.push(`${agent.tools.length} tool${agent.tools.length === 1 ? '' : 's'}`);
              }
              if (agent.mcp_server_ids.length > 0) {
                summaryBits.push(`${agent.mcp_server_ids.length} MCP`);
              }
              const summaryLine = summaryBits.length > 0 ? summaryBits.join(' · ') : 'Full profile in details';

              return (
                <li
                  key={agent.id}
                  className={`agent-card agent-card--theme-${theme}`}
                  style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
                >
                  <div className="agent-card-shine" aria-hidden />
                  <div className="agent-card-body">
                    <button
                      type="button"
                      className="agent-card-main"
                      onClick={() => openDetails(agent.id)}
                      aria-haspopup="dialog"
                      aria-expanded={detailsAgentId === agent.id}
                      aria-label={`Open details: ${agent.display_name}`}
                    >
                      <span className="agent-card-header">
                        <span className="agent-card-avatar" aria-hidden>
                          {displayInitials(agent.display_name)}
                        </span>
                        <span className="agent-card-heading">
                          <span className="agent-card-title-row">
                            <span className="agent-card-name">{agent.display_name}</span>
                          </span>
                          <span className="agent-card-summary muted">{summaryLine}</span>
                        </span>
                      </span>
                    </button>
                    <footer className="agent-card-footer">
                      <div className="agent-card-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditAgent(agent);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openDetails(agent.id)}
                        >
                          Details
                        </button>
                      </div>
                    </footer>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
