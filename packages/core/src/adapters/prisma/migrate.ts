import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Minimal migration runner for the committed SQL in `prisma/migrations`.
 *
 * Why this exists: a deployed serverless function connects to an empty
 * database and fails with Prisma error P2021 ("table does not exist") because
 * nothing in the deploy pipeline applies migrations. `vercel.json` runs
 * `prisma generate`, never `prisma migrate deploy`, so the first request
 * after a fresh database is always a 401 or a 500. This module applies the
 * same SQL files the Prisma CLI would apply, and it writes the same
 * `_prisma_migrations` bookkeeping table, so a later `prisma migrate deploy`
 * sees the migrations as already applied instead of re-running them.
 *
 * Safety properties:
 *   - A Postgres advisory lock serialises concurrent cold starts.
 *   - Each migration runs in its own transaction, so a half applied file can
 *     never leave the database in a mixed state.
 *   - The catalog is checksummed. Changing an applied file is reported as
 *     drift instead of being silently re-run.
 *
 * The runner never talks to a driver directly: it takes a `MigrationSql`
 * implementation, which keeps it testable against PGlite and keeps the `pg`
 * dependency out of every package that only needs the domain model.
 */

/** Bookkeeping table created and maintained by the Prisma CLI. */
export const PRISMA_MIGRATIONS_TABLE = '_prisma_migrations';

const PRISMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36)  NOT NULL PRIMARY KEY,
    "checksum"            VARCHAR(64)  NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
)`;

const CREATE_MIGRATIONS_TABLE_SQL = `${PRISMA_MIGRATIONS_DDL};
CREATE UNIQUE INDEX IF NOT EXISTS "_prisma_migrations_migration_name_key" ON "_prisma_migrations"("migration_name");`;

/**
 * Tables every request path depends on. Used to tell "database unreachable"
 * apart from "database reachable but never migrated", which are different
 * operator actions with the same 401 symptom.
 */
export const REQUIRED_TABLES: ReadonlyArray<string> = [
  'tenants',
  'stations',
  'tanks',
  'devices',
  'tank_readings',
  'alerts',
  'api_keys',
];

/**
 * Advisory lock identifier for migration runs. Any fixed 32 bit pair works as
 * long as every instance of this application uses the same one; the values are
 * arbitrary and documented so operators can see what is holding a lock in
 * `pg_locks`.
 */
export const MIGRATION_ADVISORY_LOCK: readonly [number, number] = [0x4654_524b, 0x4d49_4752];

/**
 * The subset of a SQL driver the runner needs. `query` is parameterised and
 * used for bookkeeping reads and writes, `exec` sends a migration file
 * verbatim, and `withLock` serialises the whole run.
 */
export interface MigrationSql {
  query<Row>(sql: string, params?: ReadonlyArray<unknown>): Promise<ReadonlyArray<Row>>;
  exec(sql: string): Promise<void>;
  withLock<T>(run: () => Promise<T>): Promise<T>;
}

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export type AppliedMigrationState = 'applied' | 'failed' | 'drift';

export interface AppliedMigration {
  readonly id: string;
  readonly name: string;
  readonly state: AppliedMigrationState;
  readonly checksum: string;
  readonly logs: string | null;
}

export interface MigrationRunSummary {
  readonly status: 'applied' | 'up_to_date' | 'failed';
  readonly directory: string;
  readonly available: number;
  readonly applied: ReadonlyArray<string>;
  /** Applied migrations whose committed file changed after it ran. */
  readonly drift: ReadonlyArray<string>;
  /** Pending migrations older than an already applied one. */
  readonly outOfOrder: ReadonlyArray<string>;
}

/**
 * Static SQL listing the required tables. The names come from a compile time
 * constant, never from input, so the query needs no parameters and can be used
 * through Prisma's tagged template API.
 */
export function requiredTablesSqlList(): string {
  return REQUIRED_TABLES.map((table) => `'${table}'`).join(', ');
}

export type SchemaStatus =
  | { readonly status: 'migrated' }
  | { readonly status: 'unmigrated'; readonly missingTables: ReadonlyArray<string> }
  | { readonly status: 'unknown'; readonly reason: string; readonly code?: string };

export interface MigrationErrorDetails {
  readonly migration?: string;
  readonly reason: string;
  readonly code?: string;
}

export class MigrationError extends Error {
  readonly details: MigrationErrorDetails;

  constructor(message: string, details: MigrationErrorDetails, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
    this.details = details;
  }
}

export interface RunMigrationsOptions {
  readonly sql: MigrationSql;
  readonly migrations: ReadonlyArray<MigrationFile>;
  readonly directory: string;
  readonly logger?: MigrationLogger;
  /** Injectable for tests. Defaults to the system clock. */
  readonly now?: () => Date;
  /** Injectable for tests. Defaults to randomUUID. */
  readonly newId?: () => string;
}

/** Narrow logger so the runner can be used without the full core Logger. */
export interface MigrationLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/** Prisma stores the SHA-256 of the migration file, hex encoded. */
export function checksumMigration(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Orders migrations the way the Prisma CLI does: lexicographic by directory
 * name. Prisma names directories `<timestamp>_<slug>`, so lexicographic order
 * is chronological order, and `0001_init` style names sort as written.
 */
export function compareMigrationNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function describeError(error: unknown): MigrationErrorDetails {
  const reason = error instanceof Error ? error.name : 'unknown';
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  return { reason, ...(code === undefined ? {} : { code }) };
}

/** Truncates driver output before it is stored in `_prisma_migrations.logs`. */
function toLogText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}

/**
 * Applies every pending migration. Throws `MigrationError` when a file fails,
 * after recording the failure in the bookkeeping table so the next run retries
 * it instead of skipping it.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationRunSummary> {
  const sql = options.sql;
  const logger = options.logger;
  const now = options.now ?? ((): Date => new Date());
  const newId = options.newId ?? ((): string => randomUUID());
  const migrations = [...options.migrations].sort((left, right) =>
    compareMigrationNames(left.name, right.name),
  );

  return sql.withLock(async () => {
    await sql.exec(CREATE_MIGRATIONS_TABLE_SQL);
    const recorded = await readAppliedMigrations(sql);
    const pending = readPending(migrations, recorded, logger);

    if (pending.migrations.length === 0) {
      logger?.info('db.migrate_status', {
        status: 'up_to_date',
        available: migrations.length,
        applied: 0,
        drift: pending.drift,
        outOfOrder: pending.outOfOrder,
        directory: options.directory,
      });
      return {
        status: 'up_to_date',
        directory: options.directory,
        available: migrations.length,
        applied: [],
        drift: pending.drift,
        outOfOrder: pending.outOfOrder,
      };
    }

    const applied: string[] = [];
    for (const migration of pending.migrations) {
      await applyOne(sql, migration, { now, newId, logger });
      applied.push(migration.file.name);
    }

    logger?.info('db.migrate_status', {
      status: 'applied',
      available: migrations.length,
      applied,
      drift: pending.drift,
      outOfOrder: pending.outOfOrder,
      directory: options.directory,
    });

    return {
      status: 'applied',
      directory: options.directory,
      available: migrations.length,
      applied,
      drift: pending.drift,
      outOfOrder: pending.outOfOrder,
    };
  });
}

async function readAppliedMigrations(sql: MigrationSql): Promise<Map<string, AppliedMigration>> {
  const rows = await sql.query<{
    id: string;
    migration_name: string;
    checksum: string;
    rolled_back_at: Date | string | null;
    logs: string | null;
  }>(
    `SELECT id, migration_name, checksum, rolled_back_at, logs
       FROM "_prisma_migrations"`,
  );

  // A migration name is unique in the Prisma bookkeeping table, so a retry
  // reuses the failed row instead of inserting a second one.
  const applied = new Map<string, AppliedMigration>();
  for (const row of rows) {
    const previous = applied.get(row.migration_name);
    const state: AppliedMigrationState = row.rolled_back_at === null ? 'applied' : 'failed';
    if (previous !== undefined && previous.state === 'applied') {
      continue;
    }
    applied.set(row.migration_name, {
      id: row.id,
      name: row.migration_name,
      state,
      checksum: row.checksum,
      logs: row.logs,
    });
  }
  return applied;
}

interface PendingMigration {
  readonly file: MigrationFile;
  /** Bookkeeping id of the previous failed attempt, when there was one. */
  readonly retryOf: string | null;
}

interface PendingPlan {
  readonly migrations: ReadonlyArray<PendingMigration>;
  readonly drift: ReadonlyArray<string>;
  readonly outOfOrder: ReadonlyArray<string>;
}

/**
 * Splits the catalog into what must run, what changed under us and what is
 * pending out of order. Version comparison uses the database, not JavaScript
 * string order, so a future non numeric naming scheme still behaves.
 */
function readPending(
  migrations: ReadonlyArray<MigrationFile>,
  applied: ReadonlyMap<string, AppliedMigration>,
  logger?: MigrationLogger,
): PendingPlan {
  const drift: string[] = [];
  const outOfOrder: string[] = [];
  const pending: PendingMigration[] = [];
  const lastAppliedName = [...applied.keys()].sort(compareMigrationNames).pop() ?? null;

  for (const migration of migrations) {
    const record = applied.get(migration.name);

    if (record !== undefined && record.state === 'applied') {
      if (record.checksum !== migration.checksum) {
        drift.push(migration.name);
      }
      continue;
    }

    let retryOf: string | null = null;
    if (record !== undefined && record.state === 'failed') {
      retryOf = record.id;
      logger?.warn('db.migrate_retry', {
        migration: migration.name,
        previousLogs: record.logs,
      });
    }

    if (lastAppliedName !== null && compareMigrationNames(migration.name, lastAppliedName) < 0) {
      outOfOrder.push(migration.name);
    }
    pending.push({ file: migration, retryOf });
  }

  return { migrations: pending, drift, outOfOrder };
}

interface ApplyContext {
  readonly now: () => Date;
  readonly newId: () => string;
  readonly logger: MigrationLogger | undefined;
}

async function applyOne(
  sql: MigrationSql,
  pending: PendingMigration,
  context: ApplyContext,
): Promise<void> {
  const migration = pending.file;
  const id = pending.retryOf ?? context.newId();
  const started = context.now().toISOString();

  if (pending.retryOf === null) {
    await sql.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, $3, $4, 0)`,
      [id, migration.checksum, migration.name, started],
    );
  } else {
    // Reset the failed attempt so the retry owns one row, keeping the unique
    // index on migration_name that the Prisma CLI relies on.
    await sql.query(
      `UPDATE "_prisma_migrations"
          SET checksum = $2, started_at = $3, finished_at = NULL,
              rolled_back_at = NULL, logs = NULL, applied_steps_count = 0
        WHERE id = $1`,
      [id, migration.checksum, started],
    );
  }

  try {
    // One transaction per file. Postgres aborts a transaction on the first
    // error, so a failing statement can never leave a partially applied file.
    await sql.exec(`BEGIN;
${migration.sql}
COMMIT;`);
  } catch (error) {
    const details = describeError(error);
    await recordFailure(sql, id, context.now().toISOString(), toLogText(error)).catch(() => {
      // The failure record is best effort: the migration error itself is what
      // the operator has to see.
    });
    throw new MigrationError(
      `migration "${migration.name}" failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      { ...details, migration: migration.name },
      { cause: error },
    );
  }

  await sql.query(
    `UPDATE "_prisma_migrations"
        SET finished_at = $2, applied_steps_count = 1, logs = NULL
      WHERE id = $1`,
    [id, context.now().toISOString()],
  );

  context.logger?.info('db.migrate_applied', {
    migration: migration.name,
    checksum: migration.checksum,
  });
}

async function recordFailure(sql: MigrationSql, id: string, finishedAt: string, logs: string) {
  await sql.query(
    `UPDATE "_prisma_migrations"
        SET rolled_back_at = $2, finished_at = $3, logs = $4
      WHERE id = $1`,
    [id, finishedAt, finishedAt, logs],
  );
}

/**
 * Reports whether the tables the API needs are present. Never throws: a driver
 * failure becomes `status: 'unknown'` with the reason and code, because the
 * caller (a health probe) must answer even when the database is broken.
 */
export async function probeSchemaStatus(sql: MigrationSql): Promise<SchemaStatus> {
  try {
    const rows = await sql.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [REQUIRED_TABLES],
    );
    const present = new Set(rows.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table));

    return missingTables.length === 0
      ? { status: 'migrated' }
      : { status: 'unmigrated', missingTables };
  } catch (error) {
    const details = describeError(error);
    return {
      status: 'unknown',
      reason: details.reason,
      ...(details.code === undefined ? {} : { code: details.code }),
    };
  }
}

/**
 * Reads `<dir>/<migration>/migration.sql` for every migration directory.
 * Folders without a `migration.sql` are ignored, matching the CLI.
 */
export async function loadMigrationCatalog(
  directory: string,
): Promise<ReadonlyArray<MigrationFile>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareMigrationNames);

  const migrations: MigrationFile[] = [];
  for (const name of names) {
    const path = join(directory, name, 'migration.sql');
    let sql: string;
    try {
      sql = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    migrations.push({ name, sql, checksum: checksumMigration(sql) });
  }
  return migrations;
}

/**
 * Candidate locations of `prisma/migrations` in a serverless bundle, where
 * `process.cwd()` and the module location disagree. An explicit
 * `FUELTRACK_MIGRATIONS_DIR` always wins and is the only entry returned.
 */
export function migrationDirCandidates(
  env: NodeJS.ProcessEnv = process.env,
  here: string = process.cwd(),
): ReadonlyArray<string> {
  const configured = env['FUELTRACK_MIGRATIONS_DIR']?.trim();
  if (configured !== undefined && configured !== '') {
    return [configured];
  }

  return [
    ...new Set([
      join(process.cwd(), 'prisma', 'migrations'),
      join(here, '..', 'prisma', 'migrations'),
      join(here, '..', '..', 'prisma', 'migrations'),
      join(here, 'prisma', 'migrations'),
    ]),
  ];
}

/**
 * Picks the first candidate directory that actually holds migrations, so the
 * filesystem probing lives in one place and stays out of the pure helpers.
 */
export async function findMigrationsDir(candidates: ReadonlyArray<string>): Promise<{
  readonly directory: string;
  readonly migrations: ReadonlyArray<MigrationFile>;
} | null> {
  for (const directory of candidates) {
    try {
      const migrations = await loadMigrationCatalog(directory);
      if (migrations.length > 0) {
        return { directory, migrations };
      }
    } catch {
      // A missing candidate is normal: the bundle layout differs per platform.
    }
  }
  return null;
}
