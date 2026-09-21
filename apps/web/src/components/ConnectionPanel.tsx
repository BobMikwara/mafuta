import { useState, useEffect } from 'react';

import type { ServiceHealth } from '../lib/api';

interface Props {
  apiKey: string;
  onConnect: (key: string) => void;
  onDisconnect: () => void;
  status: string;
  statusKind: 'idle' | 'ready' | 'error';
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

export function ConnectionPanel({
  apiKey,
  onConnect,
  onDisconnect,
  status,
  statusKind,
  health,
}: Props) {
  const [input, setInput] = useState(apiKey);

  useEffect(() => {
    setInput(apiKey);
  }, [apiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Normalize so that pasting "Bearer ftk_..." or a quoted value still works.
    let normalized = input.trim();
    if (/^Bearer\s+/i.test(normalized)) {
      normalized = normalized.replace(/^Bearer\s+/i, '').trim();
    }
    if (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      normalized = normalized.slice(1, -1).trim();
    }
    if (!normalized) return;
    onConnect(normalized);
  };

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
            className="input"
          />
          <button type="submit" className="btn primary">Connect</button>
          <button type="button" className="btn" onClick={onDisconnect}>
            Clear
          </button>
        </div>
      </form>
      <p className={`status ${statusKind}`}>{status}</p>
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
