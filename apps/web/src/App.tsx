import { useState, useEffect, useCallback } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { TanksTable } from './components/TanksTable';
import { AlertsList } from './components/AlertsList';
import { useConsoleData } from './hooks/useConsoleData';
import { fetchHealth, normalizeApiKey, type ServiceHealth } from './lib/api';

const STORAGE_KEY = 'fueltrack.apiKey';

function readStoredKey(): string {
  const stored = sessionStorage.getItem(STORAGE_KEY) || '';
  // Migrate old values that may have been saved with "Bearer " or quotes.
  const normalized = stored ? normalizeApiKey(stored) : '';
  if (normalized !== stored && normalized) {
    sessionStorage.setItem(STORAGE_KEY, normalized);
  }
  return normalized;
}

export default function App() {
  const [apiKey, setApiKey] = useState(readStoredKey);
  const [health, setHealth] = useState<ServiceHealth | null>(null);

  // The deployment health explains a rejection that has nothing to do with the
  // pasted key, so it is fetched independently of the credentials.
  useEffect(() => {
    let active = true;
    fetchHealth()
      .then((result) => {
        if (active) setHealth(result);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // A rejected key is dropped from session storage so a reload does not replay
  // it, but it stays in the input so the operator can correct or retry it.
  const handleUnauthorized = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const { tanks, latestByTank, alerts, connection, retry } = useConsoleData(
    apiKey,
    handleUnauthorized,
  );

  const handleConnect = (key: string) => {
    const normalized = normalizeApiKey(key);
    sessionStorage.setItem(STORAGE_KEY, normalized);
    if (normalized === apiKey) {
      // Same key again: the effect keyed on apiKey would not re-run, so retry.
      retry();
      return;
    }
    setApiKey(normalized);
  };

  const handleDisconnect = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setApiKey('');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>FuelTrack EA</h1>
          <p className="subtitle">Tank monitoring console – React + Supabase + Vercel</p>
        </div>
        <div className="topbar-right">
          <span className={`dot ${connection.kind}`} aria-hidden="true" />
          <span className="small">{tanks.length} tanks</span>
        </div>
      </header>

      <main>
        <ConnectionPanel
          apiKey={apiKey}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onRetry={retry}
          connection={connection}
          health={health}
        />

        <TanksTable tanks={tanks} latestByTank={latestByTank} />

        <AlertsList state={alerts} onRetry={retry} />

        <p className="footnote">
          Values tagged as <code>simulated</code> are synthetic and never presented as device
          measurements. Backend: Fastify on Vercel serverless, DB: Supabase Postgres via Prisma.
        </p>
      </main>
    </div>
  );
}
