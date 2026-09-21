import { describe, expect, it } from 'vitest';
import {
  createLogger,
  manualClock,
  toTenantId,
  type CredentialStoreStatus,
  type LogRecord,
} from '@fueltrack/core';
import { buildServer } from '../src/server.js';
import { createCredentialStatusReader } from '../src/credential-readiness.js';
import { createPlatformDependencies } from '../src/dependency-factory.js';
import type { PlatformDependencies } from '../src/dependency-factory.js';

const TENANT_A = toTenantId('tenant-a');
const PRESENTED_SECRET = 'ftk_key-not-provisioned_do-not-log-me';

interface Fixture {
  readonly deps: PlatformDependencies;
  readonly records: LogRecord[];
  readonly app: Awaited<ReturnType<typeof buildServer>>;
  close(): Promise<void>;
}

/**
 * Builds the real server with a readable log sink. The assertions below are
 * about what an operator can learn from the platform logs, which is the only
 * place a rejected key can be explained without telling an attacker whether a
 * key exists.
 */
async function createFixture(options: { readonly withReader: boolean }): Promise<Fixture> {
  const records: LogRecord[] = [];
  const logger = createLogger({ sink: (record) => records.push(record), minLevel: 'debug' });
  const deps = createPlatformDependencies({
    logger,
    clock: manualClock('2026-01-01T00:00:00.000Z'),
  });

  const app = await buildServer(
    options.withReader
      ? { ...deps, credentialStatus: createCredentialStatusReader(deps.apiKeys) }
      : deps,
  );

  return {
    deps,
    records,
    app,
    close: async () => {
      await app.close();
    },
  };
}

async function rejections(records: readonly LogRecord[]): Promise<readonly LogRecord[]> {
  return records.filter((record) => record.message === 'auth.rejected');
}

describe('rejected credentials', () => {
  it('explains an unknown key while never echoing it', async () => {
    const fixture = await createFixture({ withReader: true });
    try {
      await fixture.deps.issueApiKey({
        tenantId: TENANT_A,
        name: 'provisioned',
        scopes: ['tanks:read'],
      });

      const response = await fixture.app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${PRESENTED_SECRET}` },
      });

      // The HTTP contract is unchanged: one message for every rejection, so a
      // caller cannot tell a wrong key from a revoked one.
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: 'unauthorized',
        message: 'Valid API key credentials are required',
        requestId: expect.any(String),
      });

      const [rejection] = await rejections(fixture.records);
      expect(rejection?.context['reason']).toBe('credential_not_found');
      expect(rejection?.context['usableCredentials']).toBe(1);
      expect(rejection?.context['requestId']).toBe(response.json().requestId);

      const serialized = JSON.stringify(fixture.records);
      expect(serialized).not.toContain(PRESENTED_SECRET);
      expect(serialized).not.toContain('do-not-log-me');
    } finally {
      await fixture.close();
    }
  });

  it('reports a provisioning fault, not a bad key, when the store is empty', async () => {
    const fixture = await createFixture({ withReader: true });
    try {
      const response = await fixture.app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${PRESENTED_SECRET}` },
      });

      // This is the failure that was reported as "API key rejected" for a
      // correct key: nothing is provisioned, so no key can be accepted.
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: 'credentials_not_provisioned' });

      const [rejection] = await rejections(fixture.records);
      expect(rejection?.level).toBe('error');
      expect(rejection?.context['reason']).toBe('credential_not_found');
      expect(rejection?.context['usableCredentials']).toBe(0);
      expect(String(rejection?.context['hint'])).toContain('key:provision');
      // The remediation belongs in the logs, not in an HTTP body.
      expect(JSON.stringify(response.json())).not.toContain('key:provision');
      expect(JSON.stringify(fixture.records)).not.toContain(PRESENTED_SECRET);
    } finally {
      await fixture.close();
    }
  });

  it('reports malformed credentials separately from unknown ones', async () => {
    const fixture = await createFixture({ withReader: true });
    try {
      await fixture.deps.issueApiKey({
        tenantId: TENANT_A,
        name: 'provisioned',
        scopes: ['tanks:read'],
      });

      const response = await fixture.app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${'x'.repeat(300)}` },
      });

      expect(response.statusCode).toBe(401);
      const [rejection] = await rejections(fixture.records);
      expect(rejection?.context['reason']).toBe('malformed_credentials');
      expect(JSON.stringify(fixture.records)).not.toContain('x'.repeat(300));
    } finally {
      await fixture.close();
    }
  });

  it('reports the empty store even when the presented value is malformed', async () => {
    // Any presented value is unresolvable while nothing is provisioned, so the
    // deployment fault is reported instead of blaming the shape of the key.
    const fixture = await createFixture({ withReader: true });
    try {
      const response = await fixture.app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${'x'.repeat(300)}` },
      });

      expect(response.statusCode).toBe(503);
      const [rejection] = await rejections(fixture.records);
      expect(rejection?.context['reason']).toBe('malformed_credentials');
      expect(rejection?.context['usableCredentials']).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  it('keeps an unauthenticated probe out of the warn and error levels', async () => {
    // A missing header is not a provisioning signal, and letting an
    // unauthenticated caller raise the log level is a cheap way to fill log
    // storage. It is recorded once at debug for header-stripping proxies.
    const fixture = await createFixture({ withReader: true });
    try {
      const response = await fixture.app.inject({ method: 'GET', url: '/v1/tanks' });
      expect(response.statusCode).toBe(401);

      const [record] = await rejections(fixture.records);
      expect(record?.level).toBe('debug');
      expect(record?.context['reason']).toBe('missing_credentials');
    } finally {
      await fixture.close();
    }
  });

  it('keeps returning unauthorized when no store reader is configured', async () => {
    const fixture = await createFixture({ withReader: false });
    try {
      const response = await fixture.app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${PRESENTED_SECRET}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: 'unauthorized' });
    } finally {
      await fixture.close();
    }
  });

  it('never lets a failing diagnostics read change the outcome', async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ sink: (record) => records.push(record), minLevel: 'debug' });
    const deps = createPlatformDependencies({
      logger,
      clock: manualClock('2026-01-01T00:00:00.000Z'),
    });
    const brokenReader = (): Promise<CredentialStoreStatus> =>
      Promise.reject(new Error('diagnostics unavailable'));
    const app = await buildServer({ ...deps, credentialStatus: brokenReader });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${PRESENTED_SECRET}` },
      });
      expect(response.statusCode).toBe(401);
      const [rejection] = await rejections(records);
      expect(rejection?.context['reason']).toBe('credential_not_found');
      expect(rejection?.context['usableCredentials']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('accepted credentials', () => {
  it('authenticates a provisioned key and logs no rejection', async () => {
    const fixture = await createFixture({ withReader: true });
    try {
      const issued = await fixture.deps.issueApiKey({
        tenantId: TENANT_A,
        name: 'console',
        scopes: ['tanks:read'],
      });

      const response = await fixture.app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${issued.secret}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ tanks: [] });
      expect(await rejections(fixture.records)).toHaveLength(0);
      expect(JSON.stringify(fixture.records)).not.toContain(issued.secret);
    } finally {
      await fixture.close();
    }
  });
});
