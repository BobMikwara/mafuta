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

async function request<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Cache-Control': 'no-store',
    },
  });

  if (res.status === 401) {
    throw new Error('API key rejected. Check the key and try again.');
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
