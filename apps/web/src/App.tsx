import { useState, useEffect, useCallback, useRef } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { TanksTable } from './components/TanksTable';
import { AlarmsList } from './components/AlarmsList';
import {
  fetchTanks,
  fetchReadings,
  fetchAlarms,
  fetchHealth,
  normalizeApiKey,
  type Tank,
  type Reading,
  type Alarm,
  type ServiceHealth,
} from './lib/api';

const STORAGE_KEY = 'fueltrack.apiKey';
const REFRESH_MS = 5000;

export default function App() {
  const [apiKey, setApiKey] = useState(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY) || '';
    // Migrate old values that may have been saved with "Bearer " or quotes.
    const normalized = stored ? normalizeApiKey(stored) : '';
    if (normalized !== stored && normalized) {
      sessionStorage.setItem(STORAGE_KEY, normalized);
    }
    return normalized;
  });
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [latestByTank, setLatestByTank] = useState<Record<string, Reading>>({});
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [status, setStatus] = useState('Enter API key to connect');
  const [statusKind, setStatusKind] = useState<'idle' | 'ready' | 'error'>('idle');
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const timerRef = useRef<number | null>(null);

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

  const refresh = useCallback(async (key: string) => {
    try {
      const [tanksRes, alarmsRes] = await Promise.all([fetchTanks(key), fetchAlarms(key)]);
      const tankList = tanksRes.tanks || [];
      setTanks(tankList);

      const latestEntries = await Promise.all(
        tankList.map(async (tank) => {
          try {
            const r = await fetchReadings(key, tank.id, 1);
            return { tankId: tank.id, reading: r.readings[0] || null };
          } catch {
            return { tankId: tank.id, reading: null };
          }
        }),
      );

      const map: Record<string, Reading> = {};
      for (const entry of latestEntries) {
        if (entry.reading) map[entry.tankId] = entry.reading;
      }
      setLatestByTank(map);
      setAlarms(alarmsRes.alarms || []);
      setStatus(`Connected. Last update ${new Date().toLocaleTimeString()}`);
      setStatusKind('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load data';
      setStatus(msg);
      setStatusKind('error');
    }
  }, []);

  const startPolling = useCallback(
    (key: string) => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      refresh(key);
      timerRef.current = window.setInterval(() => refresh(key), REFRESH_MS);
    },
    [refresh],
  );

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (apiKey) {
      startPolling(apiKey);
    }
    return () => stopPolling();
  }, [apiKey, startPolling, stopPolling]);

  const handleConnect = (key: string) => {
    const normalized = normalizeApiKey(key);
    sessionStorage.setItem(STORAGE_KEY, normalized);
    setApiKey(normalized);
  };

  const handleDisconnect = () => {
    stopPolling();
    sessionStorage.removeItem(STORAGE_KEY);
    setApiKey('');
    setTanks([]);
    setLatestByTank({});
    setAlarms([]);
    setStatus('Disconnected');
    setStatusKind('idle');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>FuelTrack EA</h1>
          <p className="subtitle">Tank monitoring console – React + Supabase + Vercel</p>
        </div>
        <div className="topbar-right">
          <span className={`dot ${statusKind}`} />
          <span className="small">{tanks.length} tanks</span>
        </div>
      </header>

      <main>
        <ConnectionPanel
          apiKey={apiKey}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          status={status}
          statusKind={statusKind}
          health={health}
        />

        <TanksTable tanks={tanks} latestByTank={latestByTank} />

        <AlarmsList alarms={alarms} />

        <p className="footnote">
          Values tagged as <code>simulated</code> are synthetic and never presented as device measurements.
          Backend: Fastify on Vercel serverless, DB: Supabase Postgres via Prisma.
        </p>
      </main>
    </div>
  );
}
