import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createSilentLogger } from '@fueltrack/core';
import { buildServer } from '../src/server.js';
import { createPlatformDependencies } from '../src/dependency-factory.js';
import { ALL_SCOPES, TENANT_A, bearer, type TestHarness } from './helpers.js';

// Vitest runs from the repository root, so the dashboard assets live here.
const DASHBOARD_DIR = join(process.cwd(), 'apps', 'api-server', 'public');

describe('dashboard serving', () => {
  let harness: { app: Awaited<ReturnType<typeof buildServer>>; close: () => Promise<void> };

  beforeEach(async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    await deps.issueApiKey({ tenantId: TENANT_A, name: 'test', scopes: ALL_SCOPES });
    const app = await buildServer(deps, { dashboardDir: DASHBOARD_DIR });
    harness = { app, close: () => app.close() };
  });

  afterEach(async () => {
    await harness.close();
  });

  it('serves the console page as html', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('FuelTrack EA');
  });

  it('serves the console assets', async () => {
    const script = await harness.app.inject({ method: 'GET', url: '/public/dashboard.js' });
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('javascript');

    const styles = await harness.app.inject({ method: 'GET', url: '/public/dashboard.css' });
    expect(styles.statusCode).toBe(200);
    expect(styles.headers['content-type']).toContain('text/css');
  });

  it('refuses any asset outside the allow list', async () => {
    for (const path of [
      '/public/package.json',
      '/public/../package.json',
      '/public/index.html',
      '/public/..%2fpackage.json',
      '/public/../../prisma/schema.prisma',
    ]) {
      const response = await harness.app.inject({ method: 'GET', url: path });
      expect(response.statusCode).toBe(404);
    }
  });

  it('relaxes the content security policy only for html', async () => {
    const html = await harness.app.inject({ method: 'GET', url: '/' });
    const json = await harness.app.inject({ method: 'GET', url: '/healthz' });
    expect(html.headers['content-security-policy']).toContain("script-src 'self'");
    expect(json.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('keeps the api routes working when the dashboard is served', async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    const key = await deps.issueApiKey({ tenantId: TENANT_A, name: 'console', scopes: ALL_SCOPES });
    const app = await buildServer(deps, { dashboardDir: DASHBOARD_DIR });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/tanks',
      headers: bearer(key.secret),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('returns a structured error when the dashboard directory is missing', async () => {
    const deps = createPlatformDependencies({ logger: createSilentLogger() });
    const app = await buildServer(deps, { dashboardDir: join(process.cwd(), 'no-such-directory') });
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
    await app.close();
  });
});

export type { TestHarness };
