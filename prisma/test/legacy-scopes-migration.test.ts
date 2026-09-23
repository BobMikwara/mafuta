import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies the committed migrations through 0004 and checks that stored scope
 * names are rewritten without granting anything new. Each file is applied
 * once; a second call applies only 0004, because replaying 0001 would try to
 * create types that already exist.
 */
const MIGRATIONS = [
  '0001_init',
  '0002_idempotency_key',
  '0003_add_api_keys',
  '0004_rename_legacy_scopes',
];

async function apply(db: PGlite, name: string): Promise<void> {
  const sql = await readFile(
    join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'),
    'utf8',
  );
  await db.exec(sql);
}

describe('legacy scope migration', () => {
  it('rewrites site and alarm scopes and leaves current scopes alone', async () => {
    const db = await PGlite.create();
    try {
      for (const name of MIGRATIONS.slice(0, 3)) {
        await apply(db, name);
      }
      await db.exec(
        `insert into tenants (id, name, slug, "updatedAt") values ('t1', 'Tenant', 'tenant', now())`,
      );
      await db.exec(
        `insert into api_keys (id, "tenantId", name, "keyHash", scopes, "updatedAt")
         values
           ('k-legacy', 't1', 'legacy', 'hash-legacy', ARRAY['sites:read','sites:write','alarms:read','tanks:read'], now()),
           ('k-both', 't1', 'both', 'hash-both', ARRAY['tanks:read','sites:write','stations:write'], now()),
           ('k-current', 't1', 'current', 'hash-current', ARRAY['stations:write','tanks:write'], now())`,
      );

      await apply(db, '0004_rename_legacy_scopes');

      const rows = await db.query<{ id: string; scopes: string[] }>(
        `select id, scopes from api_keys order by id`,
      );
      const byId = new Map(rows.rows.map((row) => [row.id, row.scopes]));
      expect(byId.get('k-legacy')).toEqual([
        'stations:read',
        'stations:write',
        'alerts:read',
        'tanks:read',
      ]);
      expect(byId.get('k-both')).toEqual(['tanks:read', 'stations:write']);
      expect(byId.get('k-current')).toEqual(['stations:write', 'tanks:write']);

      // A second application must not change a row that no longer has a legacy name.
      await apply(db, '0004_rename_legacy_scopes');
      const again = await db.query<{ id: string; scopes: string[] }>(
        `select id, scopes from api_keys where id = 'k-legacy'`,
      );
      expect(again.rows[0]?.scopes).toEqual([
        'stations:read',
        'stations:write',
        'alerts:read',
        'tanks:read',
      ]);
    } finally {
      await db.close();
    }
  });
});
