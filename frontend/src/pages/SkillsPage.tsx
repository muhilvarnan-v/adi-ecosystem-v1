import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { listIntegrations } from '../api/integrations';
import { createSkill, deleteSkill, listSkills, updateSkill } from '../api/skills';
import { PlusIcon, SkillIcon, TrashIcon } from '../components/Icons';
import type { IntegrationStatus, Skill } from '../types';
import { registryIdFromDisplayName } from '../utils/registryIdFromDisplayName';

const SKILL_ID_FROM_NAME_OPTS = { skillRegistry: true, fallbackSlug: 'skill' } as const;

function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);

  const [skillId, setSkillId] = useState('');
  const [skillIdTouched, setSkillIdTouched] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [skillMd, setSkillMd] = useState('');
  const [keywordTrigger, setKeywordTrigger] = useState('');

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
    if (!showCreateModal) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showCreateModal]);

  function resetForm() {
    setSkillId('');
    setSkillIdTouched(false);
    setDisplayName('');
    setDescription('');
    setSkillMd('');
    setKeywordTrigger('');
  }

  function closeModal() {
    setShowCreateModal(false);
    setEditingSkillId(null);
    resetForm();
  }

  function openEditSkill(skill: Skill) {
    setEditingSkillId(skill.id);
    setSkillId(skill.skill_id);
    setSkillIdTouched(true);
    setDisplayName(skill.display_name);
    setDescription(skill.description ?? '');
    setSkillMd('');
    setKeywordTrigger(skill.keyword_trigger ?? '');
    setShowCreateModal(true);
  }

  async function handleManualSubmit(e: FormEvent) {
    e.preventDefault();
    if (!skillId.trim() || !displayName.trim()) return;
    if (!editingSkillId && !skillMd.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editingSkillId) {
        const patch: { display_name: string; description: string; skill_md?: string; keyword_trigger?: string } = {
          display_name: displayName.trim(),
          description: description.trim(),
        };
        if (skillMd.trim()) {
          patch.skill_md = skillMd.trim();
        }
        if (keywordTrigger.trim() !== '') {
          patch.keyword_trigger = keywordTrigger.trim();
        }
        const updated = await updateSkill(editingSkillId, patch);
        setSkills((s) => s.map((x) => (x.id === editingSkillId ? updated : x)));
      } else {
        await createSkill({
          skill_id: skillId.trim(),
          display_name: displayName.trim(),
          description: description.trim(),
          skill_md: skillMd,
          keyword_trigger: keywordTrigger.trim() || undefined,
        });
        await load();
      }
      closeModal();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : editingSkillId ? 'Failed to update skill' : 'Failed to create skill',
      );
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
    <div className="modal-overlay" role="presentation" onClick={closeModal}>
      <div
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="skill-modal-title">{editingSkillId ? 'Edit skill' : 'Create skill'}</h2>
          <button type="button" className="modal-close" onClick={closeModal} aria-label="Close">
            ×
          </button>
        </div>

        {editingSkillId ? (
          <form onSubmit={handleManualSubmit} className="form">
            <label>
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={200}
                placeholder="My Skill"
                autoFocus
              />
            </label>
            <label>
              Skill ID
              <input value={skillId} readOnly className="muted" />
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
              Keyword trigger (optional)
              <input
                value={keywordTrigger}
                onChange={(e) => setKeywordTrigger(e.target.value)}
                maxLength={500}
                placeholder="e.g., 'fix-bug', 'add-feature' - leave empty for always on"
              />
              <span className="field-hint">
                Skill is triggered when keyword is mentioned in agent context. Leave empty to always include this skill.
              </span>
            </label>
            <label>
              SKILL.md (optional)
              <textarea
                value={skillMd}
                onChange={(e) => setSkillMd(e.target.value)}
                rows={8}
                placeholder="Paste a full replacement for SKILL.md, or leave blank to keep the current file in the registry."
              />
              <span className="field-hint">
                Updating SKILL.md re-publishes the skill in the registry. Leave blank if you only need to change the
                title or description.
              </span>
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <PlusIcon />
                {submitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        ) : (
          <>
          <form onSubmit={handleManualSubmit} className="form">
            <label>
              Display name
              <input
                value={displayName}
                onChange={(e) => {
                  const v = e.target.value;
                  setDisplayName(v);
                  if (!skillIdTouched) {
                    setSkillId(registryIdFromDisplayName(v, SKILL_ID_FROM_NAME_OPTS));
                  }
                }}
                required
                maxLength={200}
                placeholder="My Skill"
                autoFocus
              />
            </label>
            <label>
              Skill ID
              <input
                value={skillId}
                onChange={(e) => {
                  setSkillIdTouched(true);
                  setSkillId(e.target.value.toLowerCase());
                }}
                required
                pattern="[a-z][a-z0-9-]*[a-z0-9]"
                maxLength={63}
                placeholder="my-skill"
                title="Lowercase letters, numbers, and hyphens. Must start with a letter."
              />
              <span className="field-hint">
                Auto-filled from the display name; edit if you need a different immutable Skill Registry id (cannot
                start with gcp-).
              </span>
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
              Keyword trigger (optional)
              <input
                value={keywordTrigger}
                onChange={(e) => setKeywordTrigger(e.target.value)}
                maxLength={500}
                placeholder="e.g., 'fix-bug', 'add-feature' - leave empty for always on"
              />
              <span className="field-hint">
                Skill is triggered when keyword is mentioned in agent context. Leave empty to always include this skill.
              </span>
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
              <button type="button" className="btn btn-secondary" onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                <PlusIcon />
                {submitting ? 'Creating…' : 'Create skill'}
              </button>
            </div>
          </form>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Skills</h1>
        <p className="muted">
          Configure agent-compatible skills (SKILL.md plus scripts/, references/, and assets/). Add them manually or
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
          <ul className="goal-list skill-list skill-list-compact">
            {skills.map((skill) => {
              const showSkillIdInSubline =
                skill.display_name.trim().toLowerCase() !== skill.skill_id.trim().toLowerCase();
              const sublineHasGithub = skill.source === 'github';
              const showSubline = showSkillIdInSubline || sublineHasGithub;

              return (
              <li key={skill.id} className="goal-item skill-item skill-item-compact">
                <div className="skill-item-body">
                  <div className="skill-item-title-row">
                    <h3 title={`${skill.display_name} · ${skill.skill_id}`}>{skill.display_name}</h3>
                    <span className={`badge badge-${skill.source}`}>{sourceLabel(skill.source)}</span>
                  </div>
                  {showSubline ? (
                  <p className="skill-item-subline">
                    {showSkillIdInSubline ? (
                      <>
                        <code className="skill-id-code">{skill.skill_id}</code>
                        {sublineHasGithub ? (
                          <span className="skill-item-sep" aria-hidden>
                            ·
                          </span>
                        ) : null}
                      </>
                    ) : null}
                    {sublineHasGithub ? (
                        skill.github_repo ? (
                          <a
                            href={`https://github.com/${skill.github_repo}`}
                            target="_blank"
                            rel="noreferrer"
                            className="skill-repo-inline"
                            title={`${skill.github_repo}${skill.github_branch ? `@${skill.github_branch}` : ''}${skill.github_base_path ? ` — ${skill.github_base_path}` : ''}`}
                          >
                            {skill.github_repo}
                            {skill.github_branch ? `@${skill.github_branch}` : ''}
                            {skill.github_base_path ? ` · ${skill.github_base_path}` : ''}
                          </a>
                        ) : (
                          <span className="muted">Repo not linked</span>
                        )
                    ) : null}
                  </p>
                  ) : null}
                  {skill.description?.trim() ? (
                    <p className="skill-item-desc" title={skill.description}>
                      {skill.description}
                    </p>
                  ) : null}
                  <div className="skill-item-foot">
                    <span className="skill-item-meta-bits">
                      {skill.state ? (
                        <>
                          <span className="skill-state">{skill.state}</span>
                          <span aria-hidden> · </span>
                        </>
                      ) : null}
                      <time dateTime={skill.created_at}>
                        {new Date(skill.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </time>
                    </span>
                    {skill.include_patterns && skill.include_patterns.length > 0 ? (
                      <details className="skill-patterns-inline">
                        <summary>
                          {skill.include_patterns.length} pattern
                          {skill.include_patterns.length === 1 ? '' : 's'}
                        </summary>
                        <ul className="skill-patterns-inline-list">
                          {skill.include_patterns.map((p) => (
                            <li key={p}>
                              <code>{p}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                </div>
                <div className="skill-item-actions-col">
                  {skill.github_repo ? (
                    <a
                      href={`https://github.com/${skill.github_repo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-secondary btn-sm skill-item-icon-btn"
                      aria-label={`Open ${skill.github_repo} on GitHub`}
                      title="Open on GitHub"
                    >
                      <ExternalLinkIcon />
                    </a>
                  ) : null}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditSkill(skill)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(skill.id)}>
                    <TrashIcon />
                    Delete
                  </button>
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
