import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { listGitHubRepos, listIntegrations } from '../api/integrations';
import { createSkill, createSkillFromGitHub, deleteSkill, listSkills } from '../api/skills';
import { ExternalLinkIcon, PlusIcon, SkillIcon, TrashIcon } from '../components/Icons';
import type { GitHubRepo, IntegrationStatus, Skill } from '../types';

function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

const DEFAULT_INCLUDE_PATTERNS = ['SKILL.md', 'scripts/**', 'references/**', 'assets/**'];

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createTab, setCreateTab] = useState<'manual' | 'github'>('manual');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [skillId, setSkillId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [skillMd, setSkillMd] = useState('');

  const [selectedRepo, setSelectedRepo] = useState('');
  const [manualRepo, setManualRepo] = useState('');
  const [reposLoading, setReposLoading] = useState(false);
  const [reposLoadError, setReposLoadError] = useState<string | null>(null);
  const [branch, setBranch] = useState('main');
  const [basePath, setBasePath] = useState('');
  const [includePatterns, setIncludePatterns] = useState(DEFAULT_INCLUDE_PATTERNS.join(', '));

  const githubConnected = integrations.find((i) => i.provider === 'github')?.connected;

  const loadGitHubRepos = useCallback(async () => {
    if (!githubConnected) {
      setGithubRepos([]);
      setReposLoadError(null);
      return;
    }
    setReposLoading(true);
    setReposLoadError(null);
    try {
      const repos = await listGitHubRepos();
      setGithubRepos(repos);
      if (repos.length > 0) {
        setSelectedRepo((current) => {
          if (current && repos.some((r) => r.full_name === current)) {
            return current;
          }
          const first = repos[0];
          setBranch(first.default_branch || 'main');
          return first.full_name;
        });
      }
    } catch (e) {
      setGithubRepos([]);
      setReposLoadError(e instanceof Error ? e.message : 'Failed to load GitHub repositories');
    } finally {
      setReposLoading(false);
    }
  }, [githubConnected]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [skillsData, integrationsData] = await Promise.all([listSkills(), listIntegrations()]);
      setSkills(skillsData);
      setIntegrations(integrationsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (integrations.length === 0) return;
    if (githubConnected) {
      void loadGitHubRepos();
    } else {
      setGithubRepos([]);
      setReposLoadError(null);
    }
  }, [integrations, githubConnected, loadGitHubRepos]);

  useEffect(() => {
    if (showCreateModal && createTab === 'github' && githubConnected) {
      void loadGitHubRepos();
    }
  }, [showCreateModal, createTab, githubConnected, loadGitHubRepos]);

  useEffect(() => {
    if (!showCreateModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeCreateModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showCreateModal]);

  function resetForm() {
    setSkillId('');
    setDisplayName('');
    setDescription('');
    setSkillMd('');
    setBasePath('');
    setManualRepo('');
    setReposLoadError(null);
    setIncludePatterns(DEFAULT_INCLUDE_PATTERNS.join(', '));
    setCreateTab('manual');
  }

  function effectiveGitHubRepo(): string {
    return (selectedRepo || manualRepo).trim();
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    resetForm();
  }

  function handleRepoChange(fullName: string) {
    setSelectedRepo(fullName);
    const repo = githubRepos.find((r) => r.full_name === fullName);
    if (repo) setBranch(repo.default_branch);
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (!skillId.trim() || !displayName.trim() || !skillMd.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createSkill({
        skill_id: skillId.trim(),
        display_name: displayName.trim(),
        description: description.trim(),
        skill_md: skillMd,
      });
      closeCreateModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create skill');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGitHubSubmit(e: FormEvent) {
    e.preventDefault();
    const repo = effectiveGitHubRepo();
    if (!skillId.trim() || !displayName.trim() || !repo) return;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      setError('Repository must be in owner/repo format (e.g. my-org/my-skill-repo).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const patterns = includePatterns
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      await createSkillFromGitHub({
        skill_id: skillId.trim(),
        display_name: displayName.trim(),
        description: description.trim(),
        repo,
        branch: branch.trim() || 'main',
        base_path: basePath.trim(),
        include_patterns: patterns.length > 0 ? patterns : DEFAULT_INCLUDE_PATTERNS,
      });
      closeCreateModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import skill from GitHub');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this skill from Skill Registry? The skill ID stays reserved for 24 hours.')) return;
    try {
      await deleteSkill(id);
      setSkills((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete skill');
    }
  }

  function sourceLabel(source: Skill['source']) {
    return source === 'github' ? 'GitHub' : 'Manual';
  }

  const createModal = showCreateModal && (
    <div className="modal-overlay" role="presentation" onClick={closeCreateModal}>
      <div
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-skill-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="create-skill-title">Create skill</h2>
          <button type="button" className="modal-close" onClick={closeCreateModal} aria-label="Close">
            ×
          </button>
        </div>

        <div className="tabs">
          <button
            type="button"
            className={createTab === 'manual' ? 'tab active' : 'tab'}
            onClick={() => setCreateTab('manual')}
          >
            Manual
          </button>
          <button
            type="button"
            className={createTab === 'github' ? 'tab active' : 'tab'}
            onClick={() => setCreateTab('github')}
            disabled={!githubConnected}
            title={!githubConnected ? 'Connect GitHub in Integrations' : undefined}
          >
            From GitHub
          </button>
        </div>

        {createTab === 'manual' && (
          <form onSubmit={handleManualSubmit} className="form">
            <label>
              Skill ID
              <input
                value={skillId}
                onChange={(e) => setSkillId(e.target.value.toLowerCase())}
                required
                pattern="[a-z][a-z0-9-]*[a-z0-9]"
                maxLength={63}
                placeholder="my-skill-id"
                title="Lowercase letters, numbers, and hyphens. Must start with a letter."
                autoFocus
              />
              <span className="field-hint">Immutable ID used in Skill Registry (cannot start with gcp-)</span>
            </label>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={200}
                placeholder="My Skill"
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="What does this skill help agents do?"
              />
            </label>
            <label>
              SKILL.md
              <textarea
                value={skillMd}
                onChange={(e) => setSkillMd(e.target.value)}
                rows={8}
                required
                placeholder="# My Skill&#10;&#10;Instructions for the agent…"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <PlusIcon />
                {submitting ? 'Creating…' : 'Create skill'}
              </button>
            </div>
          </form>
        )}

        {createTab === 'github' && (
          <form onSubmit={handleGitHubSubmit} className="form">
            {reposLoadError && <div className="alert alert-error">{reposLoadError}</div>}
            <label>
              Repository
              <select
                value={selectedRepo}
                onChange={(e) => handleRepoChange(e.target.value)}
                disabled={reposLoading || githubRepos.length === 0}
                autoFocus
              >
                {reposLoading ? (
                  <option value="">Loading repositories…</option>
                ) : githubRepos.length === 0 ? (
                  <option value="">No repositories in dropdown</option>
                ) : (
                  githubRepos.map((repo) => (
                    <option key={repo.id} value={repo.full_name}>
                      {repo.full_name}
                      {repo.private ? ' (private)' : ''}
                    </option>
                  ))
                )}
              </select>
              <span className="field-hint">
                {githubRepos.length === 0
                  ? 'If the list is empty, type owner/repo below (you still need GitHub connected).'
                  : 'Pick a repository from your GitHub account.'}
              </span>
            </label>
            <label>
              Or type owner/repo
              <input
                value={manualRepo}
                onChange={(e) => setManualRepo(e.target.value.trim())}
                placeholder="my-org/my-skills-repo"
                pattern="[\w.-]+/[\w.-]+"
                maxLength={200}
              />
            </label>
            <label>
              Branch
              <input value={branch} onChange={(e) => setBranch(e.target.value)} required maxLength={200} />
            </label>
            <label>
              Base path
              <input
                value={basePath}
                onChange={(e) => setBasePath(e.target.value)}
                maxLength={500}
                placeholder="skills/my-skill (optional subdirectory)"
              />
              <span className="field-hint">Only files under this path are considered</span>
            </label>
            <label>
              Include patterns
              <input
                value={includePatterns}
                onChange={(e) => setIncludePatterns(e.target.value)}
                required
                placeholder="SKILL.md, scripts/**, references/**"
              />
              <span className="field-hint">Comma-separated glob patterns (must include SKILL.md)</span>
            </label>
            <label>
              Skill ID
              <input
                value={skillId}
                onChange={(e) => setSkillId(e.target.value.toLowerCase())}
                required
                pattern="[a-z][a-z0-9-]*[a-z0-9]"
                maxLength={63}
                placeholder="my-skill-id"
              />
            </label>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={200}
                placeholder="My Skill"
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="What does this skill help agents do?"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeCreateModal}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !effectiveGitHubRepo()}
              >
                <PlusIcon />
                {submitting ? 'Importing…' : 'Import from GitHub'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Skills</h1>
        <p className="muted">
          Configure OpenHands-compatible skills (SKILL.md plus scripts/, references/, and assets/). Add them manually or
          link a GitHub repo. GitHub skills are re-fetched when you create an agent and when a goal runs with that agent.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {createModal}

      <section className="card">
        <div className="card-header card-header-actions">
          <div className="card-header-title">
            <h2>Your skills</h2>
            {!loading && skills.length > 0 && <span className="card-count">{skills.length}</span>}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateModal(true)}>
            <PlusIcon />
            Add skill
          </button>
        </div>
        {loading ? (
          <div className="empty-state">
            <LoadingIndicator />
          </div>
        ) : skills.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <SkillIcon />
            </div>
            <p>No skills yet.</p>
          </div>
        ) : (
          <ul className="goal-list skill-list">
            {skills.map((skill) => (
              <li key={skill.id} className="goal-item skill-item">
                <div className="goal-item-header">
                  <h3>{skill.display_name}</h3>
                  <span className={`badge badge-${skill.source}`}>{sourceLabel(skill.source)}</span>
                </div>
                <p className="skill-id muted small">ID: {skill.skill_id}</p>
                {skill.source === 'github' && (
                  <p className="skill-repo muted small">
                    Repository:{' '}
                    {skill.github_repo ? (
                      <>
                        <a
                          href={`https://github.com/${skill.github_repo}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {skill.github_repo}
                        </a>
                        {skill.github_branch ? `@${skill.github_branch}` : ''}
                        {skill.github_base_path ? ` · ${skill.github_base_path}` : ''}
                      </>
                    ) : (
                      'not recorded — re-import from GitHub to link a repo'
                    )}
                  </p>
                )}
                {skill.description && <p className="goal-desc">{skill.description}</p>}
                <div className="goal-meta">
                  <span>
                    {skill.state && <span className="skill-state">{skill.state} · </span>}
                    Created {new Date(skill.created_at).toLocaleString()}
                  </span>
                </div>
                {skill.include_patterns && skill.include_patterns.length > 0 && (
                  <p className="muted small skill-patterns">Patterns: {skill.include_patterns.join(', ')}</p>
                )}
                <div className="goal-actions">
                  {skill.github_repo && (
                    <a
                      href={`https://github.com/${skill.github_repo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary btn-sm"
                    >
                      <ExternalLinkIcon />
                      View repo
                    </a>
                  )}
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(skill.id)}>
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
