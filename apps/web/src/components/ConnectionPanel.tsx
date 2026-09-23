import { useState, useEffect } from 'react';

import { normalizeApiKey, type ServiceHealth } from '../lib/api';
import type { ConnectionState } from '../hooks/useConsoleData';

interface Props {
  apiKey: string;
  onConnect: (key: string) => void;
  onDisconnect: () => void;
  onRetry: () => void;
  connection: ConnectionState;
  /** Result of the last `/healthz` call, or null when it could not be read. */
  health: ServiceHealth | null;
}

/** Plain-language state of the credential store on the server side. */
function credentialSummary(health: ServiceHealth | null): string {
  const state = health?.credentials;
  if (state === 'ready') return 'a key is provisioned for this deployment';
  if (state === 'empty') return 'no API key is provisioned for this deployment';
  if (state === 'unavailable') return 'the API key store cannot be read by this deployment';
  return 'API key store state unknown';
}

const STATUS_LABEL: Record<ConnectionState['kind'], string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  ready: 'Connected',
  limited: 'Limited access',
  error: 'Connection problem',
};

export function ConnectionPanel({
  apiKey,
  onConnect,
  onDisconnect,
  onRetry,
  connection,
  health,
}: Props) {
  const [input, setInput] = useState(apiKey);

  useEffect(() => {
    setInput(apiKey);
  }, [apiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Normalize so that pasting "Bearer ftk_..." or a quoted value still works.
    const normalized = normalizeApiKey(input);
    if (!normalized) return;
    onConnect(normalized);
  };

  const handleClear = () => {
    setInput('');
    onDisconnect();
  };

  const canRetry =
    apiKey.length > 0 && (connection.kind === 'error' || connection.kind === 'limited');

  return (
    <section className="panel">
      <h2>Connection</h2>
      <form onSubmit={handleSubmit} className="connection-form">
        <label htmlFor="api-key">API Key</label>
        <div className="row">
          <input
            id="api-key"
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste the API key issued for this tenant"
            spellCheck={false}
            autoComplete="off"
            className="input"
          />
          <button type="submit" className="btn primary">
            Connect
          </button>
          <button type="button" className="btn" onClick={handleClear}>
            Clear
          </button>
        </div>
      </form>
      <div className={`status-block ${connection.kind}`} role="status" aria-live="polite">
        <span className={`status-label ${connection.kind}`}>{STATUS_LABEL[connection.kind]}</span>
        <p className={`status ${connection.kind}`}>{connection.message}</p>
        {canRetry ? (
          <button type="button" className="btn small-btn" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
      <p className="hint">
        API URL: <code>{import.meta.env.VITE_API_URL || window.location.origin}</code>
      </p>
      <p className="hint">
        Server credentials: <code>{credentialSummary(health)}</code>
        {health?.credentials === 'empty'
          ? ' Provision one with npm run key:provision, or start the API with FUELTRACK_SEED_DEMO=true and FUELTRACK_DEV_API_KEY.'
          : ''}
      </p>
    </section>
  );
}
