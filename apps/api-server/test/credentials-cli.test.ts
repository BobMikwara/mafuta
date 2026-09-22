import { describe, expect, it } from 'vitest';
import { buildServer, createPlatformDependencies } from '@fueltrack/api';
import { createLogger, toTenantId } from '@fueltrack/core';
import { runCredentialsCli, type RunOptions } from '../src/cli/credentials.js';
import { provisionApiKey, verifyApiKey } from '../src/cli/keys.js';

const TENANT = 'demo-tenant';

/** A minimal async iterable that stands in for a piped stdin. */
function stdinFrom(text: string): NodeJS.ReadStream {
  return {
    [Symbol.asyncIterator]: async function* iterate() {
      yield Buffer.from(text);
    },
  } as unknown as NodeJS.ReadStream;
}

interface CliRun {
  readonly code: number;
  readonly lines: readonly string[];
}

async function run(argv: ReadonlyArray<string>, options: { stdin?: string } = {}): Promise<CliRun> {
  const lines: string[] = [];
  const runOptions: RunOptions = {
    argv,
    // An explicit environment keeps persistence resolution away from whatever
    // DATABASE_URL the test runner happens to have.
    env: { USE_PRISMA: 'false', FUELTRACK_DEMO_TENANT_ID: TENANT },
    stdin: stdinFrom(options.stdin ?? ''),
    write: (line) => lines.push(line),
  };
  return { code: await runCredentialsCli(runOptions), lines };
}

describe('credentials CLI arguments', () => {
  it('prints usage and succeeds for --help', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.lines.join('\n')).toContain('Usage: credentials');
  });

  it('fails with a usage error for an unknown command', async () => {
    const result = await run(['rotate']);
    expect(result.code).toBe(2);
    expect(result.lines.join('\n')).toContain('Unknown command "rotate"');
  });

  it('refuses a key passed as an argument', async () => {
    // Secrets in argv end up in shell history and the process table, so the
    // CLI accepts them only on stdin.
    const result = await run(['verify', '--key', 'ftk_key_in_argv']);
    expect(result.code).toBe(2);
    expect(result.lines.join('\n')).toContain('Unknown argument "--key"');
  });

  it('rejects a missing flag value', async () => {
    const result = await run(['provision', '--tenant']);
    expect(result.code).toBe(2);
    expect(result.lines.join('\n')).toContain('Missing value for --tenant');
  });
});

describe('credentials CLI behavior', () => {
  it('provisions a key that the running server accepts', async () => {
    // The end to end guarantee: provisioning a credential is enough to
    // authenticate against the same store, without the demo seed.
    const deps = createPlatformDependencies({
      logger: createLogger({ sink: () => {}, minLevel: 'critical' }),
    });
    const provisioned = await provisionApiKey({
      apiKeys: deps.apiKeys,
      tenantId: TENANT,
      name: 'operator-provisioned-key',
      scopes: ['tanks:read'],
      createdAt: deps.clock.now().toISOString(),
    });

    const app = await buildServer(deps);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${provisioned.secret}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ tanks: [], summaries: [] });
    } finally {
      await app.close();
    }
  });

  it('refuses to provision a key that no server could ever see', async () => {
    // Writing to the in-memory store produces a key that is rejected by every
    // other process, which is how a correct key gets reported as bad.
    const result = await run(['provision', '--tenant', TENANT, '--name', 'console']);
    expect(result.code).toBe(1);
    const output = result.lines.join('\n');
    expect(output).toContain('Refusing to provision into the in-memory store');
    expect(output).toContain('USE_PRISMA=true');
    expect(output).not.toContain('API key (shown once');
  });

  it('provisions on request into the in-memory store for in-process use', async () => {
    const result = await run([
      'provision',
      '--tenant',
      TENANT,
      '--name',
      'console',
      '--allow-ephemeral',
    ]);
    expect(result.code).toBe(0);
    const output = result.lines.join('\n');
    expect(output).toContain('Provisioned key');
    expect(output).toContain('shown once');
    // The in-memory default cannot serve another process, and saying so is the
    // difference between a confusing 401 and a fixed deployment.
    expect(output).toContain('Persistence is in-memory');
    expect(output).not.toContain('keyHash');
  });

  it('lists provisioned keys without exposing key material', async () => {
    const result = await run(['list', '--tenant', TENANT]);
    expect(result.code).toBe(1);
    const output = result.lines.join('\n');
    expect(output).toContain('No API keys are stored in this process');
    // The empty answer is explained, not left to look like an empty deployment.
    expect(output).toContain('in-memory');
  });

  it('reports a rejected key without echoing it', async () => {
    const result = await run(['verify', '--tenant', TENANT], { stdin: 'ftk_key_unknown_secret\n' });
    expect(result.code).toBe(1);
    const output = result.lines.join('\n');
    expect(output).toContain('REJECTED');
    expect(output).not.toContain('ftk_key_unknown_secret');
  });

  it('reports a key that belongs to another tenant', async () => {
    const deps = createPlatformDependencies({
      logger: createLogger({ sink: () => {}, minLevel: 'critical' }),
    });
    const issued = await deps.issueApiKey({
      tenantId: toTenantId('another-tenant'),
      name: 'other',
      scopes: ['tanks:read'],
    });

    const outcome = await verifyApiKey({
      apiKeys: deps.apiKeys,
      secret: issued.secret,
      tenantId: TENANT,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('another-tenant');
      expect(outcome.reason).not.toContain(issued.secret);
    }
  });

  it('accepts a key that is present in the store', async () => {
    const deps = createPlatformDependencies({
      logger: createLogger({ sink: () => {}, minLevel: 'critical' }),
    });
    const issued = await deps.issueApiKey({
      tenantId: toTenantId(TENANT),
      name: 'console',
      scopes: ['tanks:read'],
    });

    const outcome = await verifyApiKey({
      apiKeys: deps.apiKeys,
      secret: `  ${issued.secret}  `,
      tenantId: TENANT,
    });
    expect(outcome.ok).toBe(true);
  });

  it('refuses an operator supplied secret that is too short', async () => {
    const deps = createPlatformDependencies({
      logger: createLogger({ sink: () => {}, minLevel: 'critical' }),
    });
    await expect(
      provisionApiKey({
        apiKeys: deps.apiKeys,
        tenantId: TENANT,
        name: 'weak',
        scopes: ['tanks:read'],
        createdAt: deps.clock.now().toISOString(),
        secret: 'short',
      }),
    ).rejects.toThrow(/at least 16 characters/);
  });
});
