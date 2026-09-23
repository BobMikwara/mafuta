import {
  fetchAlerts,
  fetchReadings,
  fetchTanks,
  isApiError,
  type Alert,
  type ApiErrorKind,
  type Reading,
  type Tank,
} from './api.js';

/**
 * One console refresh cycle, as a pure function of the API responses.
 *
 * Kept out of the React hook so the decisions that matter (a 403 on alerts
 * must not take down the tank table, a 401 must stop polling) are testable
 * without a browser.
 */

export type AlertsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly alerts: ReadonlyArray<Alert> }
  | { readonly status: 'error'; readonly message: string; readonly kind: ApiErrorKind };

/**
 * - `idle`: no key entered.
 * - `connecting`: first request in flight.
 * - `ready`: every panel loaded.
 * - `limited`: the key works but alerts were refused (403). The rest of the
 *   console keeps refreshing.
 * - `error`: the core request failed.
 */
export type ConnectionKind = 'idle' | 'connecting' | 'ready' | 'limited' | 'error';

export interface ConnectionState {
  readonly kind: ConnectionKind;
  readonly message: string;
}

export type RefreshOutcome =
  | { readonly kind: 'unauthorized'; readonly message: string }
  | {
      readonly kind: 'tanks_failed';
      readonly message: string;
      /** `null` when alerts were not requested this cycle. */
      readonly alerts: AlertsState | null;
    }
  | {
      readonly kind: 'loaded';
      readonly tanks: Tank[];
      readonly latestByTank: Record<string, Reading>;
      readonly alerts: AlertsState | null;
      /** True when alerts are refused for this key (now or earlier). */
      readonly alertsRefused: boolean;
    };

export interface ConsoleClient {
  fetchTanks(key: string): Promise<{ tanks: Tank[] }>;
  fetchAlerts(key: string): Promise<{ alerts: Alert[] }>;
  fetchReadings(key: string, tankId: string, limit: number): Promise<{ readings: Reading[] }>;
}

export const defaultConsoleClient: ConsoleClient = { fetchTanks, fetchAlerts, fetchReadings };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function errorKind(error: unknown): ApiErrorKind {
  return isApiError(error) ? error.kind : 'other';
}

async function loadLatestReadings(
  client: ConsoleClient,
  key: string,
  tanks: ReadonlyArray<Tank>,
): Promise<Record<string, Reading>> {
  const entries = await Promise.all(
    tanks.map(async (tank) => {
      try {
        const result = await client.fetchReadings(key, tank.id, 1);
        return [tank.id, result.readings[0] ?? null] as const;
      } catch {
        // One tank without readings, or without read access, must not blank
        // the whole table: that tank simply shows "no data".
        return [tank.id, null] as const;
      }
    }),
  );
  const map: Record<string, Reading> = {};
  for (const [tankId, reading] of entries) {
    if (reading !== null) map[tankId] = reading;
  }
  return map;
}

function alertsFrom(result: PromiseSettledResult<{ alerts: Alert[] } | null>): AlertsState | null {
  if (result.status === 'rejected') {
    return {
      status: 'error',
      kind: errorKind(result.reason),
      message: errorMessage(result.reason, 'Unable to load alerts'),
    };
  }
  return result.value === null ? null : { status: 'ready', alerts: result.value.alerts ?? [] };
}

/**
 * Runs one refresh. Tanks and alerts are requested independently, so a key
 * that may read tanks but not alerts still gets a working tank table and a
 * precise error in the alerts panel. `skipAlerts` is set after a 403 so the
 * console does not keep requesting something it was told it may not read.
 */
export async function loadConsoleSnapshot(
  key: string,
  options: { readonly skipAlerts: boolean },
  client: ConsoleClient = defaultConsoleClient,
): Promise<RefreshOutcome> {
  const [tanksResult, alertsResult] = await Promise.allSettled([
    client.fetchTanks(key),
    options.skipAlerts ? Promise.resolve(null) : client.fetchAlerts(key),
  ]);

  const unauthorized = [tanksResult, alertsResult].find(
    (result): result is PromiseRejectedResult =>
      result.status === 'rejected' && errorKind(result.reason) === 'unauthorized',
  );
  if (unauthorized !== undefined) {
    return { kind: 'unauthorized', message: errorMessage(unauthorized.reason, 'API key rejected') };
  }

  const alerts = alertsFrom(alertsResult);
  const alertsRefused =
    options.skipAlerts || (alerts?.status === 'error' && alerts.kind === 'forbidden');

  if (tanksResult.status === 'rejected') {
    return {
      kind: 'tanks_failed',
      message: errorMessage(tanksResult.reason, 'Unable to load tanks'),
      alerts,
    };
  }

  const tanks = tanksResult.value.tanks ?? [];
  const latestByTank = await loadLatestReadings(client, key, tanks);
  return { kind: 'loaded', tanks, latestByTank, alerts, alertsRefused };
}

/** Connection line for a completed refresh. `time` is a display string. */
export function connectionFor(outcome: RefreshOutcome, time: string): ConnectionState {
  if (outcome.kind !== 'loaded') {
    return { kind: 'error', message: outcome.message };
  }
  return outcome.alertsRefused
    ? {
        kind: 'limited',
        message: `Connected with limited access. Alerts are not available to this key. Last update ${time}`,
      }
    : { kind: 'ready', message: `Connected. Last update ${time}` };
}
