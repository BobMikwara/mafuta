export interface Tank {
  id: string;
  siteId: string;
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

export interface Alarm {
  id: string;
  tankId: string;
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

interface ApiErrorBody {
  error?: string;
  message?: string;
  requestId?: string;
}

async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.clone().json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

/**
 * Error text for one kind of server rejection. The key itself is never echoed,
 * and neither is any part of it: only the server's non-secret error code, its
 * message and the API the console reached.
 */
export function describeApiFailure(status: number, body: ApiErrorBody): string {
  if (status === 503 && body.error === 'credentials_not_provisioned') {
    // The server is reachable and the key may well be correct: nothing is
    // provisioned on the server side, so blaming the pasted key would be wrong.
    return [
      'This deployment has no API key provisioned, so no key can be accepted yet.',
      'Provision one on the server (npm run key:provision) or start it with FUELTRACK_SEED_DEMO=true and FUELTRACK_DEV_API_KEY, then reconnect.',
      `API: ${apiTarget()}`,
    ].join(' ');
  }
  if (status === 401) {
    const detail = body.message ? ` ${body.message}` : '';
    return `API key rejected. Check the key and try again.${detail} API: ${apiTarget()}`;
  }
  return body.message
    ? `Request failed ${status}. API: ${apiTarget()} (${body.message})`
    : `Request failed ${status}. API: ${apiTarget()}`;
}

async function request<T>(path: string, apiKey: string): Promise<T> {
  const secret = normalizeApiKey(apiKey);
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: 'GET',
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
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
      throw new Error(
        'Unable to reach the API. Check VITE_API_URL and that the API allows CORS for this origin.',
      );
    }
    throw new Error(message);
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    if (
      res.status === 401 ||
      (res.status === 503 && body.error === 'credentials_not_provisioned')
    ) {
      throw new Error(describeApiFailure(res.status, body));
    }
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchTanks(apiKey: string): Promise<{ tanks: Tank[] }> {
  return request<{ tanks: Tank[] }>('/v1/tanks?limit=100', apiKey);
}

export async function fetchReadings(
  apiKey: string,
  tankId: string,
  limit = 1,
): Promise<{ readings: Reading[] }> {
  return request<{ readings: Reading[] }>(
    `/v1/tanks/${encodeURIComponent(tankId)}/readings?limit=${limit}`,
    apiKey,
  );
}

export async function fetchAlarms(apiKey: string): Promise<{ alarms: Alarm[] }> {
  return request<{ alarms: Alarm[] }>('/v1/alarms?status=open&limit=100', apiKey);
}

/**
 * Reads the deployment health. `/healthz` answers 503 while degraded, and the
 * body is still useful then: it names whether the database or the credential
 * store is the part that is not ready.
 */
export async function fetchHealth(): Promise<ServiceHealth> {
  const res = await fetch(apiUrl('/healthz'), {
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
