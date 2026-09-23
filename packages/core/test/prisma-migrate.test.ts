import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  PRISMA_MIGRATIONS_TABLE,
  REQUIRED_TABLES,
  checksumMigration,
  compareMigrationNames,
  loadMigrationCatalog,
  migrationDirCandidates,
  probeSchemaStatus,
  requiredTablesSqlList,
  runMigrations,
  type MigrationFile,
  type MigrationLogger,
  type MigrationSql,
} from '../src/adapters/prisma/migrate.js';

/**
 * Runs the committed migrations against a real PostgreSQL engine. PGlite is
 * PostgreSQL compiled to WebAssembly, so these assertions cover actual DDL
 * behaviour (transactions, information_schema, rollback) with no server.
 *
 * The behaviour under test is the one production depends on: a fresh database
 * becomes usable, a second run changes nothing, a failed file is retried, and
 * the bookkeeping stays compatible with `prisma migrate deploy`.
 */

const REAL_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

interface BookkeepingRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
  applied_steps_count: number;
}

function createPgliteSql(db: PGlite): MigrationSql {
  return {
    async query<Row>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<Row>> {
      const result = await db.query<Row>(sql, params as unknown[] | undefined);
      return result.rows;
    },
    async exec(sql: string): Promise<void> {
      await db.exec(sql);
    },
    // PGlite is single process, so the session advisory lock is a no-op here.
    // The lock itself is covered by the pg executor tests.
    async withLock<T>(run: () => Promise<T>): Promise<T> {
      return run();
    },
  };
}

function createRecordingLogger(): { logger: MigrationLogger; messages: string[] } {
  const messages: string[] = [];
  const record = (message: string): void => {
    messages.push(message);
  };
  return {
    messages,
    logger: {
      debug: record,
      info: record,
      warn: record,
    },
  };
}

async function readBookkeeping(db: PGlite): Promise<ReadonlyArray<BookkeepingRow>> {
  const result = await db.query<BookkeepingRow>(
    `SELECT migration_name, checksum, finished_at, rolled_back_at, logs, applied_steps_count
       FROM "_prisma_migrations" ORDER BY migration_name`,
  );
  return result.rows;
}

describe('committed migrations against a fresh PostgreSQL database', () => {
  let db: PGlite;
  let catalog: ReadonlyArray<MigrationFile>;

  beforeEach(async () => {
    db = await PGlite.create();
    catalog = await loadMigrationCatalog(REAL_MIGRATIONS_DIR);
  });

  afterEach(async () => {
    await db.close();
  });

  it('finds every committed migration in version order', () => {
    expect(catalog.map((migration) => migration.name)).toEqual([
      '0001_init',
      '0002_idempotency_key',
      '0003_add_api_keys',
      '0004_rename_legacy_scopes',
    ]);
    // The checksum is what `prisma migrate deploy` compares against.
    expect(catalog[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates the tables the API needs and records the run', async () => {
    const summary = await runMigrations({
      sql: createPgliteSql(db),
      migrations: catalog,
      directory: REAL_MIGRATIONS_DIR,
    });

    expect(summary.status).toBe('applied');
    expect(summary.applied).toEqual([
      '0001_init',
      '0002_idempotency_key',
      '0003_add_api_keys',
      '0004_rename_legacy_scopes',
    ]);
    expect(summary.drift).toEqual([]);
    expect(summary.outOfOrder).toEqual([]);

    const status = await probeSchemaStatus(createPgliteSql(db));
    expect(status).toEqual({ status: 'migrated' });

    const rows = await readBookkeeping(db);
    expect(rows.map((row) => row.migration_name)).toEqual([
      '0001_init',
      '0002_idempotency_key',
      '0003_add_api_keys',
      '0004_rename_legacy_scopes',
    ]);
    expect(rows.every((row) => row.rolled_back_at === null)).toBe(true);
    expect(rows.every((row) => row.finished_at !== null)).toBe(true);
    expect(rows.every((row) => row.applied_steps_count === 1)).toBe(true);
    expect(rows[0]?.checksum).toBe(checksumMigration(catalog[0]?.sql ?? ''));
  });

  it('is a no-op on the second cold start', async () => {
    const sql = createPgliteSql(db);
    await runMigrations({ sql, migrations: catalog, directory: REAL_MIGRATIONS_DIR });
    const { logger, messages } = createRecordingLogger();

    const second = await runMigrations({
      sql,
      migrations: catalog,
      directory: REAL_MIGRATIONS_DIR,
      logger,
    });

    expect(second.status).toBe('up_to_date');
    expect(second.applied).toEqual([]);
    expect(second.available).toBe(4);
    expect(messages).toContain('db.migrate_status');

    const rows = await readBookkeeping(db);
    expect(rows).toHaveLength(4);
  });

  it('reports drift when an applied file changes, without re-running it', async () => {
    const sql = createPgliteSql(db);
    await runMigrations({ sql, migrations: catalog, directory: REAL_MIGRATIONS_DIR });

    const editedSql = `${catalog[1]?.sql ?? ''}\n-- edited after deployment\n`;
    const edited: MigrationFile = {
      name: '0002_idempotency_key',
      sql: editedSql,
      checksum: checksumMigration(editedSql),
    };
    const drifted = [catalog[0] as MigrationFile, edited, catalog[2] as MigrationFile];
    expect(edited.checksum).not.toBe(catalog[1]?.checksum);

    const summary = await runMigrations({
      sql,
      migrations: drifted,
      directory: REAL_MIGRATIONS_DIR,
    });

    expect(summary.status).toBe('up_to_date');
    expect(summary.drift).toEqual(['0002_idempotency_key']);
    const rows = await readBookkeeping(db);
    // The recorded checksum still matches the file that actually ran.
    expect(rows[1]?.checksum).toBe(checksumMigration(catalog[1]?.sql ?? ''));
  });

  it('flags a pending migration older than an applied one', async () => {
    const sql = createPgliteSql(db);
    await runMigrations({
      sql,
      migrations: [catalog[0] as MigrationFile],
      directory: REAL_MIGRATIONS_DIR,
    });

    const late: MigrationFile = {
      name: '0000_backfill',
      sql: 'CREATE TABLE "late_addition" ("id" TEXT NOT NULL PRIMARY KEY);',
      checksum: checksumMigration('CREATE TABLE "late_addition" ("id" TEXT NOT NULL PRIMARY KEY);'),
    };

    const summary = await runMigrations({
      sql,
      migrations: [late, catalog[0] as MigrationFile],
      directory: REAL_MIGRATIONS_DIR,
    });

    expect(summary.status).toBe('applied');
    expect(summary.applied).toEqual(['0000_backfill']);
    expect(summary.outOfOrder).toEqual(['0000_backfill']);
  });

  it('rolls back a failing migration, records it, and retries after a fix', async () => {
    const sql = createPgliteSql(db);
    await runMigrations({
      sql,
      migrations: [catalog[0] as MigrationFile],
      directory: REAL_MIGRATIONS_DIR,
    });

    const brokenSql = [
      'CREATE TABLE "partial" ("id" TEXT NOT NULL PRIMARY KEY);',
      'THIS IS NOT SQL;',
    ].join('\n');
    const broken: MigrationFile = {
      name: '0004_broken',
      sql: brokenSql,
      checksum: checksumMigration(brokenSql),
    };

    await expect(
      runMigrations({
        sql,
        migrations: [catalog[0] as MigrationFile, broken],
        directory: 'fixture',
      }),
    ).rejects.toMatchObject({ name: 'MigrationError', details: { migration: '0004_broken' } });

    // The transaction rolled back, so the first statement left nothing behind.
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'partial'`,
    );
    expect(tables.rows).toHaveLength(0);

    const failedRows = await readBookkeeping(db);
    const failed = failedRows.find((row) => row.migration_name === '0004_broken');
    expect(failed?.rolled_back_at).not.toBeNull();
    expect(failed?.logs).toContain('syntax error');

    // The next run retries the failed migration and succeeds.
    const { logger, messages } = createRecordingLogger();
    const fixedSql = 'CREATE TABLE "partial" ("id" TEXT NOT NULL PRIMARY KEY);';
    const fixed: MigrationFile = {
      name: '0004_broken',
      sql: fixedSql,
      checksum: checksumMigration(fixedSql),
    };
    const summary = await runMigrations({
      sql,
      migrations: [catalog[0] as MigrationFile, fixed],
      directory: 'fixture',
      logger,
    });

    expect(summary.status).toBe('applied');
    expect(summary.applied).toEqual(['0004_broken']);
    expect(messages).toContain('db.migrate_retry');

    // The retry reuses the failed row, so the unique index on migration_name
    // that the Prisma CLI creates stays satisfied.
    const rows = await readBookkeeping(db);
    const attempts = rows.filter((row) => row.migration_name === '0004_broken');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.rolled_back_at).toBeNull();
    expect(attempts[0]?.finished_at).not.toBeNull();
    expect(attempts[0]?.checksum).toBe(checksumMigration(fixedSql));
    expect(attempts[0]?.logs).toBeNull();
  });

  it('keeps the bookkeeping table readable by the Prisma CLI', async () => {
    await runMigrations({
      sql: createPgliteSql(db),
      migrations: catalog,
      directory: REAL_MIGRATIONS_DIR,
    });

    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 ORDER BY ordinal_position`,
      [PRISMA_MIGRATIONS_TABLE],
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'checksum',
      'finished_at',
      'migration_name',
      'logs',
      'rolled_back_at',
      'started_at',
      'applied_steps_count',
    ]);
  });
});

describe('schema status probe', () => {
  it('names the missing tables on an empty database', async () => {
    const db = await PGlite.create();
    try {
      const status = await probeSchemaStatus(createPgliteSql(db));
      expect(status).toEqual({ status: 'unmigrated', missingTables: [...REQUIRED_TABLES] });
    } finally {
      await db.close();
    }
  });

  it('reports partial migrations instead of claiming health', async () => {
    const db = await PGlite.create();
    try {
      await db.exec('CREATE TABLE "tenants" ("id" TEXT NOT NULL PRIMARY KEY);');
      const status = await probeSchemaStatus(createPgliteSql(db));
      expect(status.status).toBe('unmigrated');
      if (status.status === 'unmigrated') {
        expect(status.missingTables).not.toContain('tenants');
        expect(status.missingTables).toContain('api_keys');
      }
    } finally {
      await db.close();
    }
  });

  it('returns unknown with the driver code instead of throwing', async () => {
    const failing: MigrationSql = {
      query: async () => {
        throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      },
      exec: async () => {},
      withLock: async <T>(run: () => Promise<T>) => run(),
    };
    expect(await probeSchemaStatus(failing)).toEqual({
      status: 'unknown',
      reason: 'Error',
      code: '42P01',
    });
  });
});

describe('migration catalog discovery', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fueltrack-migrations-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeMigration(name: string, sql: string): Promise<void> {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'migration.sql'), sql, 'utf8');
  }

  it('ignores folders without a migration.sql and orders the rest', async () => {
    await writeMigration('0002_second', 'SELECT 2;');
    await writeMigration('0001_first', 'SELECT 1;');
    await mkdir(join(root, 'not_a_migration'), { recursive: true });
    await writeFile(join(root, 'migration_lock.toml'), 'provider = "postgresql"', 'utf8');

    const catalog = await loadMigrationCatalog(root);
    expect(catalog.map((migration) => migration.name)).toEqual(['0001_first', '0002_second']);
    expect(await readFile(join(root, '0001_first', 'migration.sql'), 'utf8')).toBe('SELECT 1;');
  });

  it('honours FUELTRACK_MIGRATIONS_DIR above every candidate', () => {
    const configured = join(root, 'custom', 'migrations');
    expect(migrationDirCandidates({ FUELTRACK_MIGRATIONS_DIR: configured }, root)).toEqual([
      configured,
    ]);
    expect(
      migrationDirCandidates({ FUELTRACK_MIGRATIONS_DIR: '   ' }, root).length,
    ).toBeGreaterThan(1);
  });

  it('compares migration names the way the CLI orders directories', () => {
    expect(compareMigrationNames('0001_init', '0002_next')).toBe(-1);
    expect(compareMigrationNames('0002_next', '0001_init')).toBe(1);
    expect(compareMigrationNames('0001_init', '0001_init')).toBe(0);
    expect(requiredTablesSqlList()).toContain("'api_keys'");
    expect(requiredTablesSqlList()).not.toContain(';');
  });

  it('surfaces a driver failure with its SQLSTATE for the logs', async () => {
    const failing: MigrationSql = {
      query: async () => {
        throw Object.assign(new Error('permission denied for schema public'), { code: '42501' });
      },
      exec: async () => {},
      withLock: async <T>(run: () => Promise<T>) => run(),
    };

    const error = await runMigrations({
      sql: failing,
      migrations: [{ name: '0001_init', sql: 'SELECT 1;', checksum: 'x' }],
      directory: root,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe('42501');
  });
});
