import { Link } from 'react-router-dom';
import { GitHubIcon } from '../components/Icons';
import type { GitHubRepo, Goal } from '../types';

/** Route param value for goals with no `application_id`. */
export const APPLICATION_UNASSIGNED_SLUG = 'unassigned';

/**
 * Board segment for `/applications/:slug` URLs: never empty (empty `application_id` from the API
 * would otherwise yield `/applications//…`, which does not match any route).
 */
export function goalApplicationBoardSlug(
  goal: Pick<Goal, 'application_id'>,
  routeApplicationId?: string | null,
): string {
  const fromGoal = goal.application_id?.trim();
  if (fromGoal) return fromGoal;
  const fromRoute = routeApplicationId?.trim();
  if (fromRoute) return fromRoute;
  return APPLICATION_UNASSIGNED_SLUG;
}

/** Canonical goal run URL (flat path so routing is reliable). */
export function goalExecutionPath(goal: Pick<Goal, 'id'>): string {
  const id = String(goal.id ?? '').trim();
  return `/goals/${encodeURIComponent(id)}`;
}

export function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

export function repoUrlFor(repo: GitHubRepo): string {
  return repo.url ?? `https://github.com/${repo.full_name}`;
}

export function GitHubRepoField({
  repos,
  githubConnected,
  value,
  onChange,
  reposLoadError,
}: {
  repos: GitHubRepo[];
  githubConnected: boolean;
  value: string;
  onChange: (url: string) => void;
  reposLoadError?: string | null;
}) {
  if (!githubConnected) {
    return (
      <div className="form-note">
        <p className="muted small">
          <Link to="/harness/integrations">Connect GitHub</Link> in Integrations to select a repository.
        </p>
      </div>
    );
  }

  const linkedLabel = value
    ? value.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    : null;

  return (
    <div className="github-repo-field">
      {reposLoadError && <div className="alert alert-error">{reposLoadError}</div>}
      <label>
        <span className="github-repo-field-label">
          <GitHubIcon />
          GitHub repository
        </span>
        <select
          className="github-repo-field-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">No repository linked</option>
          {value && linkedLabel && !repos.some((r) => repoUrlFor(r) === value) && (
            <option value={value}>{linkedLabel} (linked)</option>
          )}
          {repos.map((repo) => (
            <option key={repo.id} value={repoUrlFor(repo)}>
              {repo.full_name}
              {repo.private ? ' (private)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Or paste repository URL
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="https://github.com/owner/repo"
          maxLength={500}
        />
      </label>
    </div>
  );
}
