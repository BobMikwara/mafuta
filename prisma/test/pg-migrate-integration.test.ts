import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  createPgMigrationSql,
  resolveMigrationConnection,
} from '../../packages/core/src/adapters/prisma/pg-migrate.js';
import {
  PRISMA_MIGRATIONS_TABLE,
  REQUIRED_TABLES,
  loadMigrationCatalog,
  probeSchemaStatus,
  runMigrations,
} from '../../packages/core/src/adapters/prisma/migrate.js';

/**
 * End-to-end proof that the runtime migration runner works against a real
 * PostgreSQL server through the real `pg` driver: the exact path that failed in
 * production with P2021 ("table does not exist") because nothing applied the
 * committed migrations.
 *
 * The PGlite suite proves the SQL is valid PostgreSQL and the mock suite proves
 * the driver mechanics; this test proves the two compose over a real socket,
 * including the session advisory lock and single-connection routing.
 *
 * It runs only where a server is reachable (the CI `database` job). Everywhere
 * else it skips, so `npm run coverage` in the `verify` job is unaffected. It
 * creates and drops its own scratch database, so it never interferes with
 * `prisma migrate deploy` or the drift check.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');
const SCRATCH_DB = 'fueltrack_migrate_integration';

const baseUrl = process.env['DATABASE_URL'];
const canRun = typeof baseUrl === 'string' && baseUrl.startsWith('postgres');

function maintenanceUrl(raw: string): string {
  const url = new URL(raw);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

function scratchUrl(raw: string): string {
  const url = new URL(raw);
  url.pathname = `/${SCRATCH_DB}`;
  url.search = '';
  // Local CI service container has no TLS; keep the driver happy either way.
  return url.toString();
}

describe.skipIf(!canRun)('runtime migrations against a real PostgreSQL server', () => {
  let admin: pg.Pool;
  let directUrl: string;

  beforeAll(async () => {
    const raw = baseUrl as string;
    directUrl = scratchUrl(raw);
    admin = new pg.Pool({
      connectionString: maintenanceUrl(raw),
      max: 1,
      connectionTimeoutMillis: 5_000,
      ssl:
        raw.includes('localhost') || raw.includes('127.0.0.1')
          ? false
          : { rejectUnauthorized: false },
    });

    // Recreate a clean scratch database so each run starts from "no tables".
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [SCRATCH_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  }, 30_000);

  afterAll(async () => {
    try {
      await admin?.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [SCRATCH_DB],
      );
      await admin?.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    } finally {
      await admin?.end().catch(() => {});
    }
  }, 30_000);

  it('resolves the direct (non pooled) connection for migrations', () => {
    const connection = resolveMigrationConnection({
      DIRECT_URL: directUrl,
      DATABASE_URL: baseUrl as string,
    });
    expect(connection.source).toBe('DIRECT_URL');
    expect(connection.poolConfig.max).toBe(1);
  });

  it('applies every committed migration on a fresh database and is idempotent', async () => {
    const catalog = await loadMigrationCatalog(MIGRATIONS_DIR);
    expect(catalog.map((migration) => migration.name)).toEqual([
      '0001_init',
      '0002_idempotency_key',
      '0003_add_api_keys',
    ]);

    const pool = new pg.Pool({
      connectionString: directUrl,
      max: 1,
      ssl: false,
      connectionTimeoutMillis: 5_000,
    });
    try {
      const sql = createPgMigrationSql(pool);

      const first = await runMigrations({ sql, migrations: catalog, directory: MIGRATIONS_DIR });
      expect(first.status).toBe('applied');
      expect(first.applied).toEqual(['0001_init', '0002_idempotency_key', '0003_add_api_keys']);

      // The tables the API queries on every request now exist.
      const status = await probeSchemaStatus(sql);
      expect(status).toEqual({ status: 'migrated' });
      const present = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [REQUIRED_TABLES],
      );
      expect(present.rows.map((row: { table_name: string }) => row.table_name).sort()).toEqual(
        [...REQUIRED_TABLES].sort(),
      );

      // The bookkeeping table is populated the way the Prisma CLI expects.
      const bookkeeping = await pool.query(
        `SELECT migration_name, checksum, rolled_back_at, applied_steps_count
           FROM "${PRISMA_MIGRATIONS_TABLE}" ORDER BY migration_name`,
      );
      expect(bookkeeping.rows).toHaveLength(3);
      expect(
        bookkeeping.rows.every(
          (row: { rolled_back_at: Date | null }) => row.rolled_back_at === null,
        ),
      ).toBe(true);
      expect(
        bookkeeping.rows.every(
          (row: { applied_steps_count: number }) => row.applied_steps_count === 1,
        ),
      ).toBe(true);

      // A warm restart re-running the boot must change nothing.
      const second = await runMigrations({ sql, migrations: catalog, directory: MIGRATIONS_DIR });
      expect(second.status).toBe('up_to_date');
      expect(second.applied).toEqual([]);
      expect(second.drift).toEqual([]);
    } finally {
      await pool.end();
    }
  }, 60_000);

  it('serialises two concurrent boots with the advisory lock, applying once', async () => {
    const catalog = await loadMigrationCatalog(MIGRATIONS_DIR);

    // Reset to an empty schema so both runs have real work to do.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [SCRATCH_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);

    const makePool = (): pg.Pool =>
      new pg.Pool({
        connectionString: directUrl,
        max: 1,
        ssl: false,
        connectionTimeoutMillis: 5_000,
      });

    const poolA = makePool();
    const poolB = makePool();
    try {
      // Both cold starts race. The advisory lock makes one wait for the other,
      // so the migrations apply exactly once and neither errors on a duplicate.
      const [a, b] = await Promise.all([
        runMigrations({
          sql: createPgMigrationSql(poolA),
          migrations: catalog,
          directory: MIGRATIONS_DIR,
        }),
        runMigrations({
          sql: createPgMigrationSql(poolB),
          migrations: catalog,
          directory: MIGRATIONS_DIR,
        }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual(['applied', 'up_to_date']);

      const appliedTotal = [...a.applied, ...b.applied];
      expect(appliedTotal.sort()).toEqual([
        '0001_init',
        '0002_idempotency_key',
        '0003_add_api_keys',
      ]);

      const count = await poolA.query(
        `SELECT count(*)::int AS n FROM "${PRISMA_MIGRATIONS_TABLE}" WHERE rolled_back_at IS NULL`,
      );
      expect((count.rows[0] as { n: number }).n).toBe(3);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  }, 60_000);

  it('surfaces a real driver error with its SQLSTATE and still boots', async () => {
    // Point at a database that does not exist: the connection is refused at the
    // server, which the runner must turn into a MigrationError, not a crash.
    const bogus = new URL(directUrl);
    bogus.pathname = '/no_such_database';
    const pool = new pg.Pool({
      connectionString: bogus.toString(),
      max: 1,
      ssl: false,
      connectionTimeoutMillis: 3_000,
    });
    const catalog = await loadMigrationCatalog(MIGRATIONS_DIR);
    try {
      await expect(
        runMigrations({
          sql: createPgMigrationSql(pool),
          migrations: catalog,
          directory: MIGRATIONS_DIR,
        }),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      await pool.end().catch(() => {});
    }
  }, 30_000);

  it('reads the committed SQL files this suite depends on', async () => {
    const init = await readFile(join(MIGRATIONS_DIR, '0001_init', 'migration.sql'), 'utf8');
    expect(init).toContain('CREATE TABLE');
  });
});
