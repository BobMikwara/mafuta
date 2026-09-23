import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceHealth } from '../src/lib/api.js';

/**
 * The console is the surface that reported "API key rejected" for a key that
 * was correct, and later a 404 "No route matches this request" while connecting.
 * These tests pin the behaviors that fix those reports: the request paths match
 * the v1 route table, every failure names its method, path and status code, the
 * message names the API that answered, and a provisioning fault on the server is
 * no longer described as a bad key. No test asserts on a secret, because the
 * client never logs or echoes one.
 */

const API_ORIGIN = 'https://api.example.test';

/** The client surface under test, typed explicitly because it is imported per test. */
interface ApiModule {
  normalizeApiKey(raw: string): string;
  apiTarget(): string;
  describeApiFailure(
    status: number,
    body: {
      error?: string;
      message?: string;
      requestId?: string;
      requiredScopes?: ReadonlyArray<string>;
    },
    diagnostics?: { method: string; path: string },
  ): string;
  fetchTanks(apiKey: string): Promise<{ tanks: unknown[] }>;
  fetchAlerts(apiKey: string): Promise<{ alerts: unknown[] }>;
  fetchHealth(): Promise<ServiceHealth>;
  isApiError(error: unknown): error is {
    kind: string;
    status: number | null;
    requiredScopes: ReadonlyArray<string>;
    requestId: string | null;
    message: string;
  };
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

  it('includes method, path and status in every failure message', async () => {
    const { describeApiFailure } = await loadApiModule();
    const message = describeApiFailure(
      404,
      { message: 'No route matches this request' },
      {
        method: 'GET',
        path: '/v1/alerts',
      },
    );
    expect(message).toContain('GET /v1/alerts');
    expect(message).toContain('status 404');
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

describe('alerts request contract', () => {
  it('reads open alerts from GET /v1/alerts with the alerts envelope', async () => {
    const { fetchAlerts } = await loadApiModule();
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          alerts: [
            {
              id: 'alt-1',
              tankId: null,
              type: 'stale_data',
              severity: 'warning',
              status: 'open',
              message: 'No reading for 60 minutes',
              raisedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        200,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAlerts('ftk_key_secret');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_ORIGIN}/v1/alerts?status=open&limit=100`);
    expect(url).not.toContain('ftk_key_secret');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer ftk_key_secret');
    expect(result.alerts).toHaveLength(1);
  });

  it('reports a missing route with method, path and status and never the key', async () => {
    const { fetchAlerts } = await loadApiModule();
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: 'not_found', message: 'No route matches this request', requestId: 'req-test' },
        404,
      ),
    );

    const failure = await fetchAlerts('ftk_key_secret').then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : 'not an error'),
    );

    expect(failure).toContain('GET /v1/alerts');
    expect(failure).toContain('status 404');
    expect(failure).toContain('No route matches this request');
    expect(failure).toContain(API_ORIGIN);
    expect(failure).not.toContain('ftk_key_secret');
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

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the request to fail');
    },
    (error: unknown) => error,
  );
}

describe('403 forbidden handling', () => {
  it('shows the server message and missing scope instead of a message-less rejection', async () => {
    const { fetchAlerts, isApiError } = await loadApiModule();
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: 'forbidden',
          reason: 'insufficient_scope',
          message:
            'This API key does not grant the alerts:read scope required for this request. Ask an administrator for a key that includes it.',
          requiredScopes: ['alerts:read'],
          requestId: 'req-403',
        },
        403,
      ),
    );

    const error = await failureOf(fetchAlerts('ftk_key_secret'));

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) return;
    expect(error.kind).toBe('forbidden');
    expect(error.status).toBe(403);
    expect(error.requiredScopes).toEqual(['alerts:read']);
    expect(error.requestId).toBe('req-403');
    expect(error.message).toContain('Access denied');
    expect(error.message).toContain('alerts:read');
    expect(error.message).toContain('GET /v1/alerts status 403');
    expect(error.message).toContain('req-403');
    expect(error.message).not.toContain('without a message');
    expect(error.message).not.toContain('API key rejected');
    expect(error.message).not.toContain('ftk_key_secret');
  });

  it('explains a bare 403 from an older server as a permission problem', async () => {
    const { describeApiFailure } = await loadApiModule();
    const message = describeApiFailure(
      403,
      { error: 'forbidden', requestId: 'req-old' },
      { method: 'GET', path: '/v1/alerts' },
    );
    expect(message).toContain('Access denied');
    expect(message).toContain('not permitted');
    expect(message).not.toContain('without a message');
  });

  it('names scopes when a 403 carries them but no message', async () => {
    const { describeApiFailure } = await loadApiModule();
    const message = describeApiFailure(403, { requiredScopes: ['alerts:read'] });
    expect(message).toContain('does not grant alerts:read');
  });
});

describe('failure classification', () => {
  it('distinguishes 401 from 403', async () => {
    const { fetchAlerts, isApiError } = await loadApiModule();
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: 'unauthorized', message: 'Valid API key credentials are required' },
        401,
      ),
    );
    const error = await failureOf(fetchAlerts('ftk_key_secret'));
    expect(isApiError(error) && error.kind).toBe('unauthorized');
    expect(error instanceof Error && error.message).toContain('unknown, revoked or expired');
  });

  it('classifies a provisioning fault, a network failure and other statuses', async () => {
    const { fetchTanks, isApiError } = await loadApiModule();

    vi.stubGlobal('fetch', async () => jsonResponse({ error: 'credentials_not_provisioned' }, 503));
    const unavailable = await failureOf(fetchTanks('k'));
    expect(isApiError(unavailable) && unavailable.kind).toBe('unavailable');

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const network = await failureOf(fetchTanks('k'));
    expect(isApiError(network) && network.kind).toBe('network');
    expect(isApiError(network) && network.status).toBe(null);

    vi.stubGlobal('fetch', async () => {
      throw new Error('socket hang up');
    });
    const raw = await failureOf(fetchTanks('k'));
    expect(isApiError(raw) && raw.message).toContain('socket hang up');

    vi.stubGlobal('fetch', async () =>
      jsonResponse({ error: 'internal_error', requestId: 'r1' }, 500),
    );
    const other = await failureOf(fetchTanks('k'));
    expect(isApiError(other) && other.kind).toBe('other');
    expect(isApiError(other) && other.message).toContain('status 500');
    expect(isApiError(other) && other.message).toContain('Request id: r1');
  });

  it('keeps a short excerpt of a non-JSON error page', async () => {
    const { fetchTanks } = await loadApiModule();
    vi.stubGlobal(
      'fetch',
      async () => new Response('<html>  Gateway   timeout </html>', { status: 504 }),
    );
    await expect(fetchTanks('k')).rejects.toThrow(/Gateway timeout/);
  });

  it('ignores a JSON error body that is not an object', async () => {
    const { fetchTanks } = await loadApiModule();
    vi.stubGlobal('fetch', async () => jsonResponse('nope', 502));
    await expect(fetchTanks('k')).rejects.toThrow(/status 502/);
  });
});
