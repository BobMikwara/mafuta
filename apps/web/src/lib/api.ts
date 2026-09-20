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

const API_BASE = import.meta.env.VITE_API_URL || '';

function apiUrl(path: string): string {
  if (API_BASE) {
    return `${API_BASE.replace(/\/$/, '')}${path}`;
  }
  return path;
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

  if (res.status === 401) {
    // Try to surface the server's message but keep the user friendly hint.
    let detail = '';
    try {
      const body = (await res.clone().json()) as { message?: string };
      if (body.message) detail = ` ${body.message}`;
    } catch {
      // ignore json parse failure
    }
    throw new Error(`API key rejected. Check the key and try again.${detail}`);
  }
  if (!res.ok) {
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

export async function fetchHealth(): Promise<{ status: string; time: string }> {
  const res = await fetch(apiUrl('/healthz'), {
    headers: { 'Cache-Control': 'no-store' },
  });
  if (!res.ok) throw new Error('Health check failed');
  return (await res.json()) as { status: string; time: string };
}
