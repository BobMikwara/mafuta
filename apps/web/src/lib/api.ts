import {
  ApiError,
  classifyFailure,
  describeApiFailure as describeFailure,
  readErrorBody,
  type ApiErrorBody,
  type RequestDiagnostics,
} from './api-errors.js';

export {
  ApiError,
  isApiError,
  type ApiErrorBody,
  type ApiErrorKind,
  type RequestDiagnostics,
} from './api-errors.js';

export interface Tank {
  id: string;
  stationId: string;
  name: string;
  product: string;
  capacityLitres: number;
  status: string;
}

export interface Reading {
  id: string;
  tankId: string;
  levelMm: number;
  waterLevelMm: number;
  netVolumeLitres: number;
  grossVolumeLitres: number;
  temperatureC: number | null;
  recordedAt: string;
  receivedAt: string;
  source: string;
  quality: string;
}

export interface Alert {
  id: string;
  tankId: string | null;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  status: string;
  message: string;
  raisedAt: string;
}

export interface ServiceHealth {
  status: string;
  time: string;
  persistence?: string;
  database?: string;
  /**
   * `ready` means this deployment holds at least one usable API key, so a
   * rejection really is about the pasted key. `empty` means no key can ever be
   * accepted until one is provisioned on the server.
   */
  credentials?: 'ready' | 'empty' | 'unavailable' | 'not_configured';
}

/**
 * The console's HTTP contract with the v1 API, kept in one place. The contract
 * test in `packages/api/test/console-contract.test.ts` replays exactly these
 * requests against a real server, so a rename on either side fails a test
 * instead of failing at the connection panel with a 404.
 */
export const CONSOLE_REQUESTS = {
  health: '/healthz',
  tanks: '/v1/tanks?limit=100',
  alerts: '/v1/alerts?status=open&limit=100',
  readings: (tankId: string, limit = 1): string =>
    `/v1/tanks/${encodeURIComponent(tankId)}/readings?limit=${limit}`,
} as const;

const API_BASE = import.meta.env.VITE_API_URL || '';

function apiUrl(path: string): string {
  if (API_BASE) {
    return `${API_BASE.replace(/\/$/, '')}${path}`;
  }
  return path;
}

/**
 * Names the API the console is actually talking to. A key is rejected by every
 * deployment that does not hold it, so "wrong project, wrong environment or
 * stale VITE_API_URL" is the first thing to rule out, and it cannot be ruled
 * out while the UI only says the key is wrong. The origin is not a secret.
 */
export function apiTarget(): string {
  if (API_BASE) {
    try {
      return new URL(API_BASE).origin;
    } catch {
      return API_BASE;
    }
  }
  // The library is also loaded outside a browser (tests, server side rendering),
  // and this module is checked without the DOM lib, so the location is read
  // structurally instead of through `window`.
  const location = (globalThis as { location?: { origin?: string } }).location;
  return typeof location?.origin === 'string' ? location.origin : 'this origin';
}

/**
 * Normalizes a pasted key: trims whitespace, strips a leading "Bearer " if the
 * operator copied the header value, and strips surrounding quotes.
 */
export function normalizeApiKey(raw: string): string {
  let key = raw.trim();
  // Tolerate "Bearer ftk_..." pasted from docs or curl examples.
  if (/^Bearer\s+/i.test(key)) {
    key = key.replace(/^Bearer\s+/i, '').trim();
  }
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  return key;
}

/**
 * Error text for one kind of server rejection, bound to the API this console
 * is talking to. See `api-errors.ts` for the classification rules.
 */
export function describeApiFailure(
  status: number,
  body: ApiErrorBody,
  diagnostics?: RequestDiagnostics,
): string {
  return describeFailure(status, body, apiTarget(), diagnostics);
}

async function request<T>(method: string, path: string, apiKey: string): Promise<T> {
  const secret = normalizeApiKey(apiKey);
  const diagnostics: RequestDiagnostics = { method, path: path.split('?')[0] ?? path };
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Fetch throws TypeError on network failure or CORS block. Surface a
    // helpful hint instead of a raw "Failed to fetch".
    const text = /Failed to fetch|NetworkError|Load failed/i.test(message)
      ? `Unable to reach the API [${diagnostics.method} ${diagnostics.path} no response]. Check your connection, VITE_API_URL and that the API allows CORS for this origin. API: ${apiTarget()}`
      : `${message} [${diagnostics.method} ${diagnostics.path} no response]`;
    throw new ApiError({ message: text, kind: 'network', status: null });
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new ApiError({
      message: describeApiFailure(res.status, body, diagnostics),
      kind: classifyFailure(res.status, body),
      status: res.status,
      body,
    });
  }
  return res.json() as Promise<T>;
}

export async function fetchTanks(apiKey: string): Promise<{ tanks: Tank[] }> {
  return request<{ tanks: Tank[] }>('GET', CONSOLE_REQUESTS.tanks, apiKey);
}

export async function fetchReadings(
  apiKey: string,
  tankId: string,
  limit = 1,
): Promise<{ readings: Reading[] }> {
  return request<{ readings: Reading[] }>('GET', CONSOLE_REQUESTS.readings(tankId, limit), apiKey);
}

export async function fetchAlerts(apiKey: string): Promise<{ alerts: Alert[] }> {
  return request<{ alerts: Alert[] }>('GET', CONSOLE_REQUESTS.alerts, apiKey);
}

/**
 * Reads the deployment health. `/healthz` answers 503 while degraded, and the
 * body is still useful then: it names whether the database or the credential
 * store is the part that is not ready.
 */
export async function fetchHealth(): Promise<ServiceHealth> {
  const res = await fetch(apiUrl(CONSOLE_REQUESTS.health), {
    headers: { 'Cache-Control': 'no-store' },
  });
  const body = (await res.json().catch(() => null)) as ServiceHealth | null;
  if (body === null) {
    throw new Error('Health check failed: the API did not return JSON');
  }
  if (!res.ok && res.status !== 503) {
    throw new Error(`Health check failed with status ${res.status}`);
  }
  return body;
}
