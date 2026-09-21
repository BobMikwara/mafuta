import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceHealth } from '../src/lib/api.js';

/**
 * The console is the surface that reported "API key rejected" for a key that
 * was correct. These tests pin the two behaviors that fix the report: the
 * message names the API that answered, and a provisioning fault on the server
 * is no longer described as a bad key. No test asserts on a secret, because the
 * client never logs or echoes one.
 */

const API_ORIGIN = 'https://api.example.test';

/** The client surface under test, typed explicitly because it is imported per test. */
interface ApiModule {
  normalizeApiKey(raw: string): string;
  apiTarget(): string;
  describeApiFailure(status: number, body: { error?: string; message?: string }): string;
  fetchTanks(apiKey: string): Promise<{ tanks: unknown[] }>;
  fetchHealth(): Promise<ServiceHealth>;
}

async function loadApiModule(): Promise<ApiModule> {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', `${API_ORIGIN}/`);
  return (await import('../src/lib/api.js')) as ApiModule;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api key normalization', () => {
  let normalizeApiKey: ApiModule['normalizeApiKey'];

  beforeEach(async () => {
    ({ normalizeApiKey } = await loadApiModule());
  });

  it('trims, unquotes and strips a pasted Bearer prefix', async () => {
    expect(normalizeApiKey('  ftk_key_secret  ')).toBe('ftk_key_secret');
    expect(normalizeApiKey('Bearer ftk_key_secret')).toBe('ftk_key_secret');
    expect(normalizeApiKey('bearer   ftk_key_secret')).toBe('ftk_key_secret');
    expect(normalizeApiKey('"ftk_key_secret"')).toBe('ftk_key_secret');
    expect(normalizeApiKey("'ftk_key_secret'")).toBe('ftk_key_secret');
  });
});

describe('api target reporting', () => {
  it('names the configured API origin, without a path or credentials', async () => {
    const { apiTarget } = await loadApiModule();
    expect(apiTarget()).toBe(API_ORIGIN);
  });

  it('names the API in a rejection message', async () => {
    const { describeApiFailure } = await loadApiModule();
    const message = describeApiFailure(401, { message: 'Valid API key credentials are required' });
    expect(message).toContain('API key rejected');
    expect(message).toContain(API_ORIGIN);
  });

  it('does not describe a provisioning fault as a rejected key', async () => {
    const { describeApiFailure } = await loadApiModule();
    const message = describeApiFailure(503, { error: 'credentials_not_provisioned' });
    expect(message).toContain('no API key provisioned');
    expect(message).toContain('key:provision');
    expect(message).toContain(API_ORIGIN);
    expect(message).not.toContain('API key rejected');
  });
});

describe('requests', () => {
  it('sends the key as a bearer header and never in the URL', async () => {
    const { fetchTanks } = await loadApiModule();
    const fetchMock = vi.fn(async () => jsonResponse({ tanks: [] }, 200));
    vi.stubGlobal('fetch', fetchMock);

    await fetchTanks('ftk_key_secret');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_ORIGIN}/v1/tanks?limit=100`);
    expect(url).not.toContain('ftk_key_secret');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer ftk_key_secret');
  });

  it('surfaces the provisioning fault when the server has no key', async () => {
    const { fetchTanks } = await loadApiModule();
    vi.stubGlobal('fetch', async () => jsonResponse({ error: 'credentials_not_provisioned' }, 503));

    await expect(fetchTanks('ftk_key_secret')).rejects.toThrow(/no API key provisioned/);
  });

  it('still reports a genuine rejection as a rejected key', async () => {
    const { fetchTanks } = await loadApiModule();
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: 'unauthorized', message: 'Valid API key credentials are required' },
        401,
      ),
    );

    await expect(fetchTanks('ftk_key_secret')).rejects.toThrow(/API key rejected/);
  });

  it('reports an unreachable API instead of a bad key', async () => {
    const { fetchTanks } = await loadApiModule();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchTanks('ftk_key_secret')).rejects.toThrow(/Unable to reach the API/);
  });
});

describe('health', () => {
  it('returns the credential state even while degraded', async () => {
    const { fetchHealth } = await loadApiModule();
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          status: 'degraded',
          time: '2026-01-01T00:00:00.000Z',
          database: 'up',
          credentials: 'empty',
        },
        503,
      ),
    );

    const health = await fetchHealth();
    expect(health.credentials).toBe('empty');
    expect(health.status).toBe('degraded');
  });

  it('fails when the API answers with something other than JSON', async () => {
    const { fetchHealth } = await loadApiModule();
    vi.stubGlobal('fetch', async () => new Response('<html>nope</html>', { status: 200 }));

    await expect(fetchHealth()).rejects.toThrow(/did not return JSON/);
  });
});
