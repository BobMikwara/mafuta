import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reading, Tank } from '../lib/api.js';
import {
  connectionFor,
  loadConsoleSnapshot,
  type AlertsState,
  type ConnectionState,
} from '../lib/console-refresh.js';

export type { AlertsState, ConnectionKind, ConnectionState } from '../lib/console-refresh.js';

const REFRESH_MS = 5000;

export interface ConsoleData {
  readonly tanks: Tank[];
  readonly latestByTank: Record<string, Reading>;
  readonly alerts: AlertsState;
  readonly connection: ConnectionState;
  /** Re-runs every request now and resumes polling if it had stopped. */
  readonly retry: () => void;
}

/**
 * Polls tanks, latest readings and open alerts for one API key. The decisions
 * live in `loadConsoleSnapshot`; this hook only schedules and stores.
 *
 * A 401 means the key is unknown, revoked or expired, so polling stops: the
 * same key cannot start working by itself, and repeating it only trips the
 * failed-authentication rate limit. A 403 on alerts stops polling alerts only.
 * Both resume through `retry`.
 */
export function useConsoleData(apiKey: string, onUnauthorized: () => void): ConsoleData {
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [latestByTank, setLatestByTank] = useState<Record<string, Reading>>({});
  const [alerts, setAlerts] = useState<AlertsState>({ status: 'idle' });
  const [connection, setConnection] = useState<ConnectionState>({
    kind: 'idle',
    message: 'Enter an API key to connect',
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Incremented whenever the key changes or a retry starts, so a response for
  // an earlier cycle can never overwrite the current state.
  const generationRef = useRef(0);
  const skipAlertsRef = useRef(false);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refresh = useCallback(
    async (key: string, generation: number) => {
      const outcome = await loadConsoleSnapshot(key, { skipAlerts: skipAlertsRef.current });
      if (generation !== generationRef.current) return;

      if (outcome.kind === 'unauthorized') {
        stopPolling();
        setAlerts({ status: 'idle' });
        setConnection(connectionFor(outcome, ''));
        onUnauthorizedRef.current();
        return;
      }
      if (outcome.alerts !== null) {
        setAlerts(outcome.alerts);
        if (outcome.alerts.status === 'error' && outcome.alerts.kind === 'forbidden') {
          skipAlertsRef.current = true;
        }
      }
      if (outcome.kind === 'loaded') {
        setTanks(outcome.tanks);
        setLatestByTank(outcome.latestByTank);
      }
      setConnection(connectionFor(outcome, new Date().toLocaleTimeString()));
    },
    [stopPolling],
  );

  const startPolling = useCallback(
    (key: string) => {
      stopPolling();
      const generation = generationRef.current;
      void refresh(key, generation);
      timerRef.current = setInterval(() => void refresh(key, generation), REFRESH_MS);
    },
    [refresh, stopPolling],
  );

  useEffect(() => {
    generationRef.current += 1;
    skipAlertsRef.current = false;
    if (apiKey) {
      setConnection({ kind: 'connecting', message: 'Connecting' });
      setAlerts({ status: 'loading' });
      startPolling(apiKey);
    } else {
      stopPolling();
      setTanks([]);
      setLatestByTank({});
      setAlerts({ status: 'idle' });
      setConnection({ kind: 'idle', message: 'Enter an API key to connect' });
    }
    return () => stopPolling();
  }, [apiKey, startPolling, stopPolling]);

  const retry = useCallback(() => {
    if (!apiKey) return;
    generationRef.current += 1;
    skipAlertsRef.current = false;
    setConnection({ kind: 'connecting', message: 'Retrying' });
    setAlerts((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    startPolling(apiKey);
  }, [apiKey, startPolling]);

  return { tanks, latestByTank, alerts, connection, retry };
}
