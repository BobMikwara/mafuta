import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies 0001 to 0004 to a real PostgreSQL instance (PGlite) and checks that
 * `0004_rename_legacy_scopes` rewrites stored API key scopes from the retired
 * site/alarm vocabulary without widening any key.
 *
 * This is the stored-data half of the fix for GET /v1/alerts answering 403 to
 * keys issued before the rename.
 */
const MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');
const ORDER = [
  '0001_init',
  '0002_idempotency_key',
  '0003_add_api_keys',
  '0004_rename_legacy_scopes',
];

async function apply(db: PGlite, name: string): Promise<void> {
  await db.exec(await readFile(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
}

async function insertKey(db: PGlite, id: string, scopes: ReadonlyArray<string>): Promise<void> {
  await db.query(
    `insert into api_keys (id, "tenantId", name, "keyHash", scopes, "updatedAt")
     values ($1, 't1', $1, $2, $3, '2026-01-01T00:00:00Z')`,
    [id, `hash-${id}`, scopes],
  );
}

async function scopesOf(db: PGlite, id: string): Promise<string[]> {
  const result = await db.query<{ scopes: string[] }>(`select scopes from api_keys where id = $1`, [
    id,
  ]);
  return result.rows[0]?.scopes ?? [];
}

describe('0004_rename_legacy_scopes', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create();
    for (const name of ORDER.slice(0, 3)) {
      await apply(db, name);
    }
    await db.exec(
      `insert into tenants (id, name, slug, "updatedAt") values ('t1', 'Tenant', 't1', now())`,
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it('renames the full pre-rename scope set in order', async () => {
    await insertKey(db, 'legacy', [
      'readings:read',
      'readings:write',
      'tanks:read',
      'tanks:write',
      'sites:read',
      'sites:write',
      'alarms:read',
      'alarms:write',
      'simulator:write',
    ]);

    await apply(db, '0004_rename_legacy_scopes');

    expect(await scopesOf(db, 'legacy')).toEqual([
      'readings:read',
      'readings:write',
      'tanks:read',
      'tanks:write',
      'stations:read',
      'stations:write',
      'alerts:read',
      'alerts:write',
      'simulator:write',
    ]);
  });

  it('removes duplicates when both names are present and adds nothing', async () => {
    await insertKey(db, 'mixed', ['alerts:read', 'alarms:read', 'tanks:read']);
    await apply(db, '0004_rename_legacy_scopes');
    expect(await scopesOf(db, 'mixed')).toEqual(['alerts:read', 'tanks:read']);
  });

  it('does not touch keys that hold only current scopes', async () => {
    await insertKey(db, 'current', ['alerts:read', 'audit:read']);
    await db.exec(`update api_keys set "updatedAt" = '2026-01-01T00:00:00Z'`);

    await apply(db, '0004_rename_legacy_scopes');

    const result = await db.query<{ scopes: string[]; updatedAt: Date }>(
      `select scopes, "updatedAt" from api_keys where id = 'current'`,
    );
    expect(result.rows[0]?.scopes).toEqual(['alerts:read', 'audit:read']);
    expect(new Date(result.rows[0]?.updatedAt ?? 0).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is idempotent when applied twice', async () => {
    await insertKey(db, 'legacy', ['alarms:read', 'sites:read']);
    await apply(db, '0004_rename_legacy_scopes');
    await apply(db, '0004_rename_legacy_scopes');
    expect(await scopesOf(db, 'legacy')).toEqual(['alerts:read', 'stations:read']);
  });

  it('ships a rollback file that runs cleanly', async () => {
    await apply(db, '0004_rename_legacy_scopes');
    const rollback = await readFile(
      join(MIGRATIONS, '0004_rename_legacy_scopes', 'rollback.sql'),
      'utf8',
    );
    await expect(db.exec(rollback)).resolves.toBeDefined();
  });
});
