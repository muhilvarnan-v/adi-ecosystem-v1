import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  disconnectIntegration,
  listIntegrations,
  startGitHubOAuth,
  startJiraOAuth,
  startTrelloOAuth,
  startZendeskOAuth,
} from '../api/integrations';
import { GitHubIcon, JiraIcon, PlugIcon, TrelloIcon, ZendeskIcon } from '../components/Icons';
import type { IntegrationProvider, IntegrationStatus } from '../types';

function LoadingIndicator() {
  return (
    <div className="loading-dots" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

const PROVIDER_ICONS: Record<IntegrationProvider, typeof JiraIcon> = {
  jira: JiraIcon,
  trello: TrelloIcon,
  github: GitHubIcon,
  zendesk: ZendeskIcon,
};

export function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [zendeskSubdomain, setZendeskSubdomain] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIntegrations(await listIntegrations());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const status = searchParams.get('status');
    const provider = searchParams.get('provider');
    if (status === 'connected' && provider) {
      setMessage(`${provider.charAt(0).toUpperCase() + provider.slice(1)} connected successfully.`);
      setSearchParams({}, { replace: true });
      load();
    } else if (status === 'error' && provider) {
      setError(`Failed to connect ${provider}. Check server OAuth credentials and try again.`);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, load]);

  async function handleConnect(provider: IntegrationProvider) {
    setError(null);
    try {
      if (provider === 'jira') await startJiraOAuth();
      else if (provider === 'trello') await startTrelloOAuth();
      else if (provider === 'zendesk') {
        const subdomain = zendeskSubdomain.trim();
        if (!subdomain) {
          setError('Enter your Zendesk subdomain (e.g. your-company from your-company.zendesk.com).');
          return;
        }
        await startZendeskOAuth(subdomain);
      } else await startGitHubOAuth();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start OAuth');
    }
  }

  async function handleDisconnect(provider: IntegrationProvider) {
    if (!confirm(`Disconnect ${provider}?`)) return;
    try {
      await disconnectIntegration(provider);
      await load();
      setMessage(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  }

  const providers: {
    id: IntegrationProvider;
    name: string;
    description: string;
    authNote: string;
    needsSubdomain?: boolean;
  }[] = [
    {
      id: 'jira',
      name: 'Jira',
      description: 'Import goals from Jira issues using Atlassian OAuth 2.0.',
      authNote: 'OAuth 2.0 (3-legged)',
    },
    {
      id: 'trello',
      name: 'Trello',
      description: 'Import goals from Trello cards. Trello uses OAuth 1.0a for user authorization.',
      authNote: 'OAuth 1.0a',
    },
    {
      id: 'zendesk',
      name: 'Zendesk',
      description: 'Import goals from Zendesk support tickets using OAuth 2.0.',
      authNote: 'OAuth 2.0',
      needsSubdomain: true,
    },
    {
      id: 'github',
      name: 'GitHub',
      description:
        'Link applications to a GitHub repository and import skills from repos into GCP Skill Registry.',
      authNote: 'OAuth 2.0',
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Integrations</h1>
        <p className="muted">
          Connect Jira, Trello, and Zendesk to import goals, and GitHub to link application repositories
          and import skills.
        </p>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="empty-state">
          <LoadingIndicator />
        </div>
      ) : (
        <div className="integration-grid">
          {providers.map((p) => {
            const status = integrations.find((i) => i.provider === p.id);
            const connected = status?.connected ?? false;
            const Icon = PROVIDER_ICONS[p.id];
            return (
              <section key={p.id} className={`card integration-card integration-card-${p.id}`}>
                <div className="integration-card-header">
                  <div className="integration-title">
                    <div className={`integration-icon integration-icon-${p.id}`}>
                      <Icon />
                    </div>
                    <h2>{p.name}</h2>
                  </div>
                  <span className={`status-pill ${connected ? 'connected' : 'disconnected'}`}>
                    {connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p className="muted">{p.description}</p>
                <p className="auth-note">{p.authNote}</p>
                {connected && status?.account_label && (
                  <p className="account-label">Account: {status.account_label}</p>
                )}
                {connected && status?.connected_at && (
                  <p className="muted small">Connected {new Date(status.connected_at).toLocaleString()}</p>
                )}
                {!connected && p.needsSubdomain && (
                  <div className="integration-subdomain-field">
                    <label>
                      Zendesk subdomain
                      <input
                        type="text"
                        value={zendeskSubdomain}
                        onChange={(e) => setZendeskSubdomain(e.target.value)}
                        placeholder="your-company"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <p className="muted small">From https://your-company.zendesk.com</p>
                  </div>
                )}
                <div className="integration-actions">
                  {connected ? (
                    <button type="button" className="btn btn-danger" onClick={() => handleDisconnect(p.id)}>
                      Disconnect
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => handleConnect(p.id)}>
                      <PlugIcon />
                      Connect {p.name}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
