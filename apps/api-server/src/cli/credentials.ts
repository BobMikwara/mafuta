import { pathToFileURL } from 'node:url';
import { createPlatformDependencies, shouldUsePrisma } from '@fueltrack/api';
import { systemClock, toTenantId } from '@fueltrack/core';
import { defaultScopes, provisionApiKey, verifyApiKey } from './keys.js';

/**
 * Operator CLI for the API key lifecycle. Exists because the API key is the
 * only credential FuelTrack accepts, and until now the only way to install one
 * was the demo seed, which silently does nothing unless FUELTRACK_SEED_DEMO is
 * exactly `true`. Deployment mistakes there are invisible: the store is simply
 * empty and every request is rejected as a bad key.
 *
 * Usage (after `npm run build`):
 *   node apps/api-server/dist/cli/credentials.js provision --tenant <id> --name <label>
 *   node apps/api-server/dist/cli/credentials.js verify [--tenant <id>] < key.txt
 *   node apps/api-server/dist/cli/credentials.js list --tenant <id>
 *
 * The presented key for `verify` is read from stdin, never from an argument,
 * because arguments are visible in the process table and land in shell history.
 * Only the hash is ever stored, and no path in this tool logs or echoes a
 * secret other than the one it has just generated.
 */
export const CREDENTIALS_USAGE = [
  'Usage: credentials <command> [options]',
  '',
  'Commands:',
  '  provision     Issue an API key and print it once',
  '  verify        Check whether this deployment accepts a key read from stdin',
  '  list          List provisioned keys for a tenant (never prints key material)',
  '',
  'Options:',
  '  --tenant <id>    Tenant identifier (default: FUELTRACK_DEMO_TENANT_ID or demo-tenant)',
  '  --name <label>   Human readable label (default: operator-provisioned-key)',
  '  --scopes <list>  Comma separated scopes (default: all API_KEY_SCOPES)',
  '  --allow-ephemeral Provision into the in-memory store (see the note below)',
  '  --help           Show this message',
  '',
  'Persistence follows the same environment as the API: USE_PRISMA=true or a',
  'DATABASE_URL selects Postgres, otherwise an in-memory store is used. The',
  'in-memory store belongs to one process, so provisioning refuses to write to',
  'it unless --allow-ephemeral is passed: a key no server can see is exactly how',
  'a correct key ends up being reported as rejected.',
].join('\n');

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface CliOptions {
  readonly command: 'provision' | 'verify' | 'list';
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: ReadonlyArray<string>;
  /**
   * Allows provisioning into the in-memory store. Off by default because a key
   * written to a process that exits immediately is a key no server can accept,
   * which is indistinguishable from a rejected key at the console.
   */
  readonly allowEphemeral: boolean;
}

function readFlag(argv: ReadonlyArray<string>, index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`Missing value for ${flag}`);
  }
  return value;
}

export function parseCliOptions(
  argv: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    throw new UsageError(CREDENTIALS_USAGE);
  }

  const command = argv[0];
  if (command !== 'provision' && command !== 'verify' && command !== 'list') {
    throw new UsageError(`Unknown command "${String(command)}"\n\n${CREDENTIALS_USAGE}`);
  }

  let tenantId = env['FUELTRACK_DEMO_TENANT_ID']?.trim() || 'demo-tenant';
  let name = 'operator-provisioned-key';
  let scopes: ReadonlyArray<string> = defaultScopes();
  let allowEphemeral = false;

  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case '--tenant':
        tenantId = readFlag(argv, index, flag);
        index += 1;
        break;
      case '--name':
        name = readFlag(argv, index, flag);
        index += 1;
        break;
      case '--scopes': {
        const raw = readFlag(argv, index, flag);
        scopes = raw
          .split(',')
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0);
        index += 1;
        break;
      }
      case '--allow-ephemeral':
        allowEphemeral = true;
        break;
      default:
        throw new UsageError(`Unknown argument "${String(flag)}"`);
    }
  }

  if (scopes.length === 0) {
    throw new UsageError('--scopes must name at least one scope');
  }

  return { command, tenantId, name, scopes, allowEphemeral };
}

/**
 * Reads the first line of stdin. Piping is required rather than typing the key
 * as an argument: `cat key.txt | ... verify`.
 */
export async function readSecretFromStdin(stdin: NodeJS.ReadStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  const first = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  return first.trim();
}

export interface RunOptions {
  readonly argv: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadStream;
  readonly write: (line: string) => void;
}

/** Returns the process exit code. Split from `process` so it can be tested. */
export async function runCredentialsCli(options: RunOptions): Promise<number> {
  let parsed: CliOptions;
  try {
    parsed = parseCliOptions(options.argv, options.env);
  } catch (error) {
    if (error instanceof UsageError) {
      options.write(error.message);
      return error.message === CREDENTIALS_USAGE ? 0 : 2;
    }
    throw error;
  }

  // The same environment the API uses decides which store is provisioned. The
  // env is passed explicitly so `USE_PRISMA`/`DATABASE_URL` resolution is
  // identical to a request path and independent of ambient process state.
  const dependencies = createPlatformDependencies({
    minLogLevel: 'error',
    clock: systemClock,
    usePrisma: shouldUsePrisma(undefined, options.env),
  });

  if (parsed.command === 'list') {
    const keys = await dependencies.apiKeys.list(toTenantId(parsed.tenantId));
    if (keys.length === 0) {
      options.write(
        dependencies.persistence === 'memory'
          ? `No API keys are stored in this process for tenant ${parsed.tenantId}. Persistence is in-memory, so a key provisioned by another command or by the server is not visible here. Set USE_PRISMA=true and DATABASE_URL to inspect the store the deployment uses.`
          : `No API keys are provisioned for tenant ${parsed.tenantId}.`,
      );
      return 1;
    }
    const suffix =
      dependencies.persistence === 'memory'
        ? ' Persistence is in-memory: these keys exist only for the lifetime of this process.'
        : '';
    options.write(`Tenant ${parsed.tenantId} has ${keys.length} key(s):${suffix}`);
    for (const key of keys) {
      options.write(
        `  id=${key.id} name=${key.name} status=${key.status} expiresAt=${key.expiresAt ?? 'never'} lastUsedAt=${key.lastUsedAt ?? 'never'}`,
      );
    }
    return 0;
  }

  if (parsed.command === 'verify') {
    const secret = await readSecretFromStdin(options.stdin);
    const outcome = await verifyApiKey({
      apiKeys: dependencies.apiKeys,
      secret,
      tenantId: parsed.tenantId,
    });
    if (!outcome.ok) {
      options.write(`REJECTED ${outcome.reason}`);
      if (dependencies.persistence === 'memory') {
        options.write(
          'Persistence is in-memory, so a running deployment holds keys provisioned by its own process. Set USE_PRISMA=true and DATABASE_URL for a durable store.',
        );
      }
      return 1;
    }
    options.write(
      `OK tenant=${outcome.record.tenantId} keyId=${outcome.record.id} name=${outcome.record.name} scopes=${outcome.record.scopes.join(',')}`,
    );
    return 0;
  }

  if (dependencies.persistence === 'memory' && !parsed.allowEphemeral) {
    options.write(
      'Refusing to provision into the in-memory store: the key would not be visible to any other process and would be lost as soon as this command exits.',
    );
    options.write(
      'Set USE_PRISMA=true and DATABASE_URL to write a durable credential, or pass --allow-ephemeral for an in-process test.',
    );
    return 1;
  }

  const provisioned = await provisionApiKey({
    apiKeys: dependencies.apiKeys,
    tenantId: parsed.tenantId,
    name: parsed.name,
    scopes: parsed.scopes,
    createdAt: dependencies.clock.now().toISOString(),
  });

  // The only place a secret is ever printed. It is printed to stdout rather
  // than through the Logger so it cannot be shipped to log aggregation.
  options.write(
    `Provisioned key ${provisioned.record.id} for tenant ${provisioned.record.tenantId}.`,
  );
  options.write(`Scopes: ${provisioned.record.scopes.join(', ')}`);
  options.write(`API key (shown once, store it in your secret manager now): ${provisioned.secret}`);
  if (dependencies.persistence === 'memory') {
    options.write(
      'Persistence is in-memory: this key is not visible to a separate server process. Set USE_PRISMA=true and DATABASE_URL, or start the server with FUELTRACK_SEED_DEMO=true and FUELTRACK_DEV_API_KEY.',
    );
  }
  return 0;
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCredentialsCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdin: process.stdin,
    write: (line) => process.stdout.write(`${line}\n`),
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error';
      process.stderr.write(`fueltrack credentials command failed: ${message}\n`);
      process.exitCode = 1;
    });
}
