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

interface RunCliOptions {
  readonly stdin?: string;
  /**
   * Shared store for multi-command flows (provision, then revoke, then verify),
   * mirroring how the commands work against one durable deployment.
   */
  readonly dependencies?: ReturnType<typeof createPlatformDependencies>;
}

async function run(argv: ReadonlyArray<string>, options: RunCliOptions = {}): Promise<CliRun> {
  const lines: string[] = [];
  const runOptions: RunOptions = {
    argv,
    // An explicit environment keeps persistence resolution away from whatever
    // DATABASE_URL the test runner happens to have.
    env: { USE_PRISMA: 'false', FUELTRACK_DEMO_TENANT_ID: TENANT },
    stdin: stdinFrom(options.stdin ?? ''),
    write: (line) => lines.push(line),
    ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
  };
  return { code: await runCredentialsCli(runOptions), lines };
}

/**
 * A dependency set with the in-memory store, for tests that drive several CLI
 * commands against one shared store the way a durable deployment behaves.
 */
function sharedStore(): ReturnType<typeof createPlatformDependencies> {
  return createPlatformDependencies({
    logger: createLogger({ sink: () => {}, minLevel: 'critical' }),
    // Pinned so an ambient DATABASE_URL in the test runner cannot redirect
    // these tests at a real database.
    usePrisma: false,
  });
}

/** Pulls the provisioned key id out of the CLI's own output. */
function provisionedKeyId(lines: readonly string[]): string {
  const line = lines.find((entry) => entry.startsWith('Provisioned key '));
  expect(line).toBeDefined();
  return (line as string).split(' ')[2] ?? '';
}

/** Pulls the one-time secret out of the CLI's own output. */
function provisionedSecret(lines: readonly string[]): string {
  const line = lines.find((entry) => entry.includes('API key (shown once'));
  expect(line).toBeDefined();
  return (line as string).split(': ').slice(1).join(': ').trim();
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

describe('credentials CLI key retirement', () => {
  it('requires --key-id for revoke', async () => {
    const result = await run(['revoke']);
    expect(result.code).toBe(2);
    expect(result.lines.join('\n')).toContain('revoke requires --key-id');
  });

  it('refuses to revoke from the in-memory store', async () => {
    // The same illusion as provisioning into memory: the running deployment
    // would keep accepting the key this command claims to have revoked.
    const result = await run(['revoke', '--tenant', TENANT, '--key-id', 'key-whatever']);
    expect(result.code).toBe(1);
    const output = result.lines.join('\n');
    expect(output).toContain('Refusing to revoke from the in-memory store');
    expect(output).toContain('USE_PRISMA=true');
  });

  it('reports an unknown key id as not revoked', async () => {
    const result = await run(
      ['revoke', '--tenant', TENANT, '--key-id', 'key-missing', '--allow-ephemeral'],
      { dependencies: sharedStore() },
    );
    expect(result.code).toBe(1);
    const output = result.lines.join('\n');
    expect(output).toContain('NOT REVOKED');
    expect(output).toContain('not provisioned for tenant');
  });

  it('revokes a key so it stops authenticating, while a replacement keeps working', async () => {
    // The rotation flow an operator performs: provision two keys, revoke one,
    // and confirm through the server that exactly the revoked one is refused.
    const deps = sharedStore();

    const first = await run(
      ['provision', '--tenant', TENANT, '--name', 'console', '--allow-ephemeral'],
      { dependencies: deps },
    );
    expect(first.code).toBe(0);
    const firstId = provisionedKeyId(first.lines);
    const firstSecret = provisionedSecret(first.lines);

    const second = await run(
      ['provision', '--tenant', TENANT, '--name', 'replacement', '--allow-ephemeral'],
      { dependencies: deps },
    );
    expect(second.code).toBe(0);
    const secondSecret = provisionedSecret(second.lines);

    const revoked = await run(
      ['revoke', '--tenant', TENANT, '--key-id', firstId, '--allow-ephemeral'],
      { dependencies: deps },
    );
    expect(revoked.code).toBe(0);
    expect(revoked.lines.join('\n')).toContain(`Revoked key ${firstId}`);
    expect(revoked.lines.join('\n')).not.toContain(firstSecret);

    // Idempotent: revoking an already revoked key succeeds and reports the fact.
    const again = await run(
      ['revoke', '--tenant', TENANT, '--key-id', firstId, '--allow-ephemeral'],
      { dependencies: deps },
    );
    expect(again.code).toBe(0);
    expect(again.lines.join('\n')).toContain('already revoked');

    const app = await buildServer(deps);
    try {
      const rejected = await app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${firstSecret}` },
      });
      expect(rejected.statusCode).toBe(401);

      const accepted = await app.inject({
        method: 'GET',
        url: '/v1/tanks',
        headers: { authorization: `Bearer ${secondSecret}` },
      });
      expect(accepted.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('does not confirm a key id that belongs to another tenant', async () => {
    const deps = sharedStore();
    const provisioned = await run(
      ['provision', '--tenant', TENANT, '--name', 'console', '--allow-ephemeral'],
      { dependencies: deps },
    );
    const keyId = provisionedKeyId(provisioned.lines);

    const result = await run(
      ['revoke', '--tenant', 'other-tenant', '--key-id', keyId, '--allow-ephemeral'],
      { dependencies: deps },
    );
    expect(result.code).toBe(1);
    const output = result.lines.join('\n');
    // The same answer as an unknown id: existence is never confirmed across
    // tenants, and the owning tenant is never named to the wrong caller.
    expect(output).toContain('NOT REVOKED');
    expect(output).toContain('not provisioned for tenant other-tenant');
    expect(output).not.toContain(`for tenant ${TENANT}`);
  });
});
