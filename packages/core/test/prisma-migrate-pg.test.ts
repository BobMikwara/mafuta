import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pgModule from 'pg';
import {
  MIGRATION_ADVISORY_LOCK,
  MigrationConfigError,
  autoMigrateOnBoot,
  createPgMigrationSql,
  resolveMigrationConnection,
  type MigrationLogger,
} from '../src/adapters/prisma/pg-migrate.js';

/**
 * Covers the deployment facing half of the migration runner: which connection
 * string is used, how the advisory lock brackets the run, and what a cold start
 * does when the feature is disabled, misconfigured, or pointed at a database it
 * cannot reach. No real server is contacted, so these tests stay offline.
 */

interface MockPoolInstance {
  readonly config: Record<string, unknown>;
  readonly queries: Array<{ sql: string; params: ReadonlyArray<unknown> | undefined }>;
  ended: boolean;
}

interface MockPoolApi {
  readonly instances: MockPoolInstance[];
  /** Test switch: makes every query of pools created after it fail. */
  failNextPools: boolean;
}

vi.mock('pg', () => {
  const state = {
    instances: [] as Array<{
      config: Record<string, unknown>;
      queries: Array<{ sql: string; params: ReadonlyArray<unknown> | undefined }>;
      ended: boolean;
    }>,
    failNextPools: false,
  };

  class MockPool {
    readonly config: Record<string, unknown>;
    readonly queries: Array<{ sql: string; params: ReadonlyArray<unknown> | undefined }> = [];
    ended = false;
    private readonly failing: boolean;

    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.failing = state.failNextPools;
      state.instances.push(this);
    }

    async connect(): Promise<{
      query: (sql: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: unknown[] }>;
      release: () => void;
    }> {
      // The locked client shares the pool's recorder so a test can assert on
      // every statement the run issued, in order.
      return { query: (sql, params) => this.query(sql, params), release: () => {} };
    }

    async query(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }> {
      this.queries.push({ sql, params });
      if (this.failing) {
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
          name: 'Error',
          code: 'ECONNREFUSED',
        });
      }
      // The bookkeeping read returns "nothing applied yet", which is what a
      // fresh database looks like.
      return { rows: [] };
    }

    async end(): Promise<void> {
      this.ended = true;
    }
  }

  return { Pool: MockPool, __state: state };
});

function mockState(): MockPoolApi {
  // The module is mocked above, so this cast is the only way to reach the
  // recorder the mock keeps.
  return (pgModule as unknown as { __state: MockPoolApi }).__state;
}

function createRecordingLogger(): {
  logger: MigrationLogger;
  entries: Array<{ level: string; message: string; context: Record<string, unknown> }>;
} {
  const entries: Array<{ level: string; message: string; context: Record<string, unknown> }> = [];
  const record =
    (level: string) =>
    (message: string, context: Record<string, unknown> = {}): void => {
      entries.push({ level, message, context });
    };
  return {
    entries,
    logger: { debug: record('debug'), info: record('info'), warn: record('warn') },
  };
}

const POOLED =
  'postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const DIRECT = 'postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';

beforeEach(() => {
  const state = mockState();
  state.instances.length = 0;
  state.failNextPools = false;
});

describe('migration connection resolution', () => {
  it('prefers DIRECT_URL because a transaction pooler cannot run DDL', () => {
    const connection = resolveMigrationConnection({ DATABASE_URL: POOLED, DIRECT_URL: DIRECT });
    expect(connection.source).toBe('DIRECT_URL');
    expect(connection.connectionString).toBe(DIRECT);
    expect(connection.poolConfig.max).toBe(1);
    expect(connection.poolConfig.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('falls back to DATABASE_URL and strips Prisma only parameters', () => {
    const connection = resolveMigrationConnection({
      DATABASE_URL: 'postgresql://fueltrack:fueltrack@localhost:5432/fueltrack_dev?schema=public',
    });
    expect(connection.source).toBe('DATABASE_URL');
    expect(connection.connectionString).toBe(
      'postgresql://fueltrack:fueltrack@localhost:5432/fueltrack_dev',
    );
    // A local docker container has no TLS listener.
    expect(connection.poolConfig.ssl).toBe(false);
  });

  it('fails with an actionable message when neither variable is set', () => {
    expect(() => resolveMigrationConnection({})).toThrow(MigrationConfigError);
    expect(() => resolveMigrationConnection({ DIRECT_URL: '   ' })).toThrow(/DIRECT_URL/);
  });

  it('keeps credentials out of everything that can be logged', () => {
    const connection = resolveMigrationConnection({
      DIRECT_URL: 'postgresql://user:secret@db.example.com:5432/app',
    });
    expect(JSON.stringify({ source: connection.source })).not.toContain('secret');
    expect(new MigrationConfigError('needs DIRECT_URL or DATABASE_URL').message).not.toContain(
      'postgresql://',
    );
    expect(connection.poolConfig.application_name).toBe('fueltrack-migrate');
  });
});

describe('pg executor', () => {
  function fakePool(failLock = false) {
    const released: number[] = [];
    const queries: Array<{ sql: string; params: ReadonlyArray<unknown> | undefined }> = [];
    const client = {
      query: async (sql: string, params?: ReadonlyArray<unknown>) => {
        queries.push({ sql, params });
        if (failLock && sql.includes('pg_advisory_lock')) {
          throw Object.assign(new Error('lock timeout'), { code: '55P03' });
        }
        return { rows: [] };
      },
      release: () => released.push(1),
    };
    const pool = {
      query: async (sql: string, params?: ReadonlyArray<unknown>) => {
        queries.push({ sql, params });
        return { rows: [{ ok: true }] };
      },
      connect: async () => client,
    };
    return { pool, queries, released };
  }

  it('holds a session advisory lock around the run and releases the client', async () => {
    const { pool, queries, released } = fakePool();
    const sql = createPgMigrationSql(pool as never);

    await expect(sql.withLock(async () => 'done')).resolves.toBe('done');

    expect(queries.map((entry) => entry.sql)).toEqual([
      'SELECT pg_advisory_lock($1, $2)',
      'SELECT pg_advisory_unlock($1, $2)',
    ]);
    expect(queries[0]?.params).toEqual([...MIGRATION_ADVISORY_LOCK]);
    expect(released).toHaveLength(1);
  });

  it('unlocks and releases the client when the run throws', async () => {
    const { pool, queries, released } = fakePool();
    const sql = createPgMigrationSql(pool as never);

    await expect(
      sql.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(queries.map((entry) => entry.sql)).toContain('SELECT pg_advisory_unlock($1, $2)');
    expect(released).toHaveLength(1);
  });

  it('releases the client when the lock itself cannot be taken', async () => {
    const { pool, queries, released } = fakePool(true);
    const sql = createPgMigrationSql(pool as never);

    await expect(sql.withLock(async () => 'never')).rejects.toThrow('lock timeout');
    expect(queries.map((entry) => entry.sql)).not.toContain('SELECT pg_advisory_unlock($1, $2)');
    expect(released).toHaveLength(1);
  });

  it('returns rows for query and nothing for exec', async () => {
    const { pool } = fakePool();
    const sql = createPgMigrationSql(pool as never);
    await expect(sql.query<{ ok: boolean }>('SELECT 1')).resolves.toEqual([{ ok: true }]);
    await expect(sql.exec('BEGIN; COMMIT;')).resolves.toBeUndefined();
  });
});

describe('cold start auto migration', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fueltrack-boot-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeMigrations(): Promise<string> {
    const dir = join(root, 'prisma', 'migrations', '0001_init');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'migration.sql'),
      'CREATE TABLE IF NOT EXISTS "tenants" ("id" TEXT NOT NULL PRIMARY KEY);',
      'utf8',
    );
    return join(root, 'prisma', 'migrations');
  }

  it('does nothing unless the operator opts in', async () => {
    const { logger, entries } = createRecordingLogger();
    const outcome = await autoMigrateOnBoot({
      logger,
      env: { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', USE_PRISMA: 'true' },
      here: root,
    });

    expect(outcome).toEqual({ status: 'disabled' });
    expect(mockState().instances).toHaveLength(0);
    expect(entries.map((entry) => entry.message)).toContain('db.migrate_disabled');
  });

  it('skips when the deployment uses in-memory persistence', async () => {
    const { logger, entries } = createRecordingLogger();
    const outcome = await autoMigrateOnBoot({
      logger,
      env: { FUELTRACK_AUTO_MIGRATE: 'true' },
      here: root,
    });

    expect(outcome).toEqual({ status: 'skipped', reason: 'memory_persistence' });
    expect(mockState().instances).toHaveLength(0);
    expect(entries.map((entry) => entry.message)).toContain('db.migrate_skipped');
  });

  it('reports a missing migrations directory instead of failing the boot', async () => {
    const { logger, entries } = createRecordingLogger();
    const outcome = await autoMigrateOnBoot({
      logger,
      env: { FUELTRACK_AUTO_MIGRATE: 'true', USE_PRISMA: 'true' },
      migrationDirs: [join(root, 'nowhere')],
    });

    expect(outcome).toMatchObject({ status: 'failed', step: 'catalog' });
    const failure = entries.find((entry) => entry.message === 'db.migrate_failed');
    expect(failure?.context['reason']).toBe('migrations_dir_not_found');
    expect(mockState().instances).toHaveLength(0);
  });

  it('reports a missing connection string without touching the network', async () => {
    const { logger, entries } = createRecordingLogger();
    const directory = await writeMigrations();

    const outcome = await autoMigrateOnBoot({
      logger,
      env: { FUELTRACK_AUTO_MIGRATE: 'true', USE_PRISMA: 'true' },
      migrationDirs: [directory],
    });

    expect(outcome).toEqual({
      status: 'failed',
      step: 'connect',
      reason: 'missing_connection_string',
    });
    expect(JSON.stringify(entries.map((entry) => entry.context))).not.toContain('postgresql://');
    expect(mockState().instances).toHaveLength(0);
  });

  it('applies the migrations it finds, locks, and closes the pool', async () => {
    const { logger, entries } = createRecordingLogger();
    const directory = await writeMigrations();

    const outcome = await autoMigrateOnBoot({
      logger,
      env: {
        FUELTRACK_AUTO_MIGRATE: 'true',
        USE_PRISMA: 'true',
        DIRECT_URL: DIRECT,
      },
      migrationDirs: [directory],
    });

    expect(outcome).toMatchObject({
      status: 'ok',
      applied: ['0001_init'],
      upToDate: false,
      connectionSource: 'DIRECT_URL',
      directory,
    });

    const instances = mockState().instances;
    expect(instances).toHaveLength(1);
    const instance = instances[0] as MockPoolInstance;
    expect(instance.ended).toBe(true);
    expect(instance.config['max']).toBe(1);

    const issued = instance.queries.map((entry) => entry.sql);
    expect(issued).toContain('SELECT pg_advisory_lock($1, $2)');
    expect(issued).toContain('SELECT pg_advisory_unlock($1, $2)');
    expect(
      issued.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS "_prisma_migrations"')),
    ).toBe(true);
    expect(issued.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS "tenants"'))).toBe(true);
    expect(
      issued.some((sql) => sql.trimStart().startsWith('INSERT INTO "_prisma_migrations"')),
    ).toBe(true);

    const success = entries.find((entry) => entry.message === 'db.migrated');
    expect(success?.context['applied']).toEqual(['0001_init']);
    expect(success?.context['connection']).toBe('DIRECT_URL');
    // A connection string is never part of the structured log context.
    expect(JSON.stringify(success?.context)).not.toContain('postgres.ref');
  });

  it('is idempotent across cold starts', async () => {
    const directory = await writeMigrations();
    const env = { FUELTRACK_AUTO_MIGRATE: 'true', USE_PRISMA: 'true', DIRECT_URL: DIRECT };
    const first = await autoMigrateOnBoot({
      logger: createRecordingLogger().logger,
      env,
      migrationDirs: [directory],
    });

    // The mock reports an empty bookkeeping table every time, which is what a
    // database looks like before the first migration; the point of this call is
    // that a second boot does not throw or leak a pool.
    const second = await autoMigrateOnBoot({
      logger: createRecordingLogger().logger,
      env,
      migrationDirs: [directory],
    });

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(mockState().instances.every((instance) => instance.ended)).toBe(true);
  });

  it('logs the driver code when the database is unreachable and still boots', async () => {
    const { logger, entries } = createRecordingLogger();
    const directory = await writeMigrations();
    mockState().failNextPools = true;

    const outcome = await autoMigrateOnBoot({
      logger,
      env: {
        FUELTRACK_AUTO_MIGRATE: 'true',
        USE_PRISMA: 'true',
        DATABASE_URL: 'postgresql://u:p@db.example.com:5432/app',
      },
      migrationDirs: [directory],
    });

    expect(outcome).toMatchObject({ status: 'failed', step: 'migrate', code: 'ECONNREFUSED' });
    const failure = entries.find((entry) => entry.message === 'db.migrate_failed');
    expect(failure?.context['code']).toBe('ECONNREFUSED');
    expect(failure?.context['connection']).toBe('DATABASE_URL');
    // The pool must not survive a failed boot.
    expect(mockState().instances.every((instance) => instance.ended)).toBe(true);
  });

  it('prefers an explicit migrations directory over the bundle candidates', async () => {
    const directory = await writeMigrations();
    const { logger } = createRecordingLogger();

    const outcome = await autoMigrateOnBoot({
      logger,
      env: {
        FUELTRACK_AUTO_MIGRATE: 'true',
        USE_PRISMA: 'true',
        DIRECT_URL: DIRECT,
        FUELTRACK_MIGRATIONS_DIR: directory,
      },
      here: join(root, 'elsewhere'),
    });

    expect(outcome).toMatchObject({ status: 'ok', directory });
  });
});
