import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, STATION_PAYLOAD, TENANT_A, type TestHarness } from './helpers.js';

/**
 * Station and tank creation fail closed when a credential lacks the write
 * scope, and they used to fail closed for a different reason: keys issued
 * before the site/alarm rename still hold sites:write, which is the same
 * permission under the old name. These tests pin both behaviours, and the
 * session endpoint the console uses to explain the difference before the
 * operator fills in a form.
 */

let harness: TestHarness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

describe('session', () => {
  it('returns the tenant and normalized scopes of the calling key', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: bearer(harness.keyForTenantA),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tenantId).toBe(TENANT_A);
    expect(body.principalId).toMatch(/^key:key-/);
    expect(body.scopes).toContain('stations:write');
    expect(body.scopes).toContain('tanks:write');
    expect(JSON.stringify(body)).not.toMatch(/ftk_|secret|hash/i);
  });

  it('rejects a missing credential', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/session' });
    expect(response.statusCode).toBe(401);
  });
});

describe('legacy station write scopes', () => {
  it('accepts a pre-rename key that holds sites:write when creating a station', async () => {
    const legacy = await harness.deps.issueApiKey({
      tenantId: TENANT_A,
      name: 'legacy-operator',
      scopes: ['sites:read', 'sites:write', 'tanks:read', 'tanks:write'],
    });

    const session = await harness.app.inject({
      method: 'GET',
      url: '/v1/session',
      headers: bearer(legacy.secret),
    });
    expect(session.json().scopes).toContain('stations:write');
    expect(session.json().scopes).not.toContain('sites:write');
    expect(session.json().scopes).not.toContain('audit:read');

    const created = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(legacy.secret),
      payload: { name: 'Mlimani', code: 'MLM-01', timezone: 'Africa/Dar_es_Salaam' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().station).toMatchObject({ name: 'Mlimani', code: 'MLM-01' });
  });

  it('explains a missing write scope instead of returning an empty 403', async () => {
    const denied = await harness.app.inject({
      method: 'POST',
      url: '/v1/stations',
      headers: bearer(harness.keyForTenantAReadonly),
      payload: STATION_PAYLOAD,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: 'forbidden',
      requiredScopes: ['stations:write'],
    });
    expect(denied.json().message).toContain('stations:write');
    expect(denied.headers['www-authenticate']).toContain('insufficient_scope');
  });
});
