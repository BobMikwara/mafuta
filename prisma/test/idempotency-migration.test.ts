import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies 0001_init followed by 0002_idempotency_key to a real PostgreSQL
 * instance. PGlite runs compiled PostgreSQL in process, so these assertions
 * need no server and no Docker.
 *
 * These tests protect the invariant that matters most for the fuel ledger: a
 * probe that retries an upload must not be able to write the same observation
 * twice, and one tenant must never be able to reuse another tenant's key.
 */
const INIT_DIR = join(process.cwd(), 'prisma', 'migrations', '0001_init');
const MIGRATION_DIR = join(process.cwd(), 'prisma', 'migrations', '0002_idempotency_key');

const INSERT_TENANT = (id: string): string =>
  `insert into tenants (id, name, slug, "updatedAt") values ('${id}', 'Tenant ${id}', '${id}', now())`;

const INSERT_STATION = `insert into stations (id, "tenantId", name, code, "updatedAt")
  values ('s1', 't1', 'Test Station', 'TS1', now())`;

const INSERT_TANK = `insert into tanks (id, "tenantId", "stationId", name, product, "capacityLitres", geometry, "updatedAt")
  values ('tk1', 't1', 's1', 'Diesel Tank 1', 'diesel', 19000.000, '{"kind":"vertical-cylinder"}', now())`;

const INSERT_DEVICE = `insert into devices (id, "tenantId", manufacturer, model, "serialNumber", "updatedAt")
  values ('d1', 't1', 'Acme', 'Probe', 'SN-1', now())`;

function insertReading(options: {
  id: string;
  tenantId: string;
  idempotencyKey: string | null;
}): string {
  const key = options.idempotencyKey === null ? 'NULL' : `'${options.idempotencyKey}'`;
  return `insert into tank_readings
    (id, "tenantId", "tankId", "deviceId", "recordedAt", "receivedAt", "levelMm", "volumeLitres", "idempotencyKey")
    values ('${options.id}', '${options.tenantId}', 'tk1', 'd1', now(), now(), 1000.00, 4908.739, ${key})`;
}

describe('idempotency migration', () => {
  let db: PGlite;

  async function applyInit(): Promise<void> {
    await db.exec(await readFile(join(INIT_DIR, 'migration.sql'), 'utf8'));
  }

  async function applyMigration(): Promise<void> {
    await db.exec(await readFile(join(MIGRATION_DIR, 'migration.sql'), 'utf8'));
  }

  beforeEach(async () => {
    db = await PGlite.create();
  });

  it('makes the idempotency key mandatory and unique per tenant', async () => {
    await applyInit();
    await applyMigration();

    const columns = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_name = 'tank_readings' and column_name = 'idempotencyKey'`,
    );
    expect(columns.rows[0]?.is_nullable).toBe('NO');

    const indexes = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'tank_readings' and indexdef ilike '%unique%'`,
    );
    const definitions = indexes.rows.map((row) => row.indexdef);
    expect(definitions.some((d) => d.includes('"tenantId", "idempotencyKey"'))).toBe(true);
    expect(definitions.some((d) => d.includes('"deviceId", "idempotencyKey"'))).toBe(false);
    await db.close();
  });

  it('backfills rows written before the key was mandatory', async () => {
    await applyInit();
    await db.exec(INSERT_TENANT('t1'));
    await db.exec(INSERT_STATION);
    await db.exec(INSERT_TANK);
    await db.exec(INSERT_DEVICE);
    await db.exec(insertReading({ id: 'r1', tenantId: 't1', idempotencyKey: null }));
    await db.exec(insertReading({ id: 'r2', tenantId: 't1', idempotencyKey: null }));

    await applyMigration();

    const result = await db.query<{ idempotencyKey: string }>(
      `select "idempotencyKey" from tank_readings order by id`,
    );
    const keys = result.rows.map((row) => row.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      expect(key).toMatch(/^idem_legacy_[0-9a-f]{32}$/);
    }
    await db.close();
  });

  it('rejects the same submission key twice for one tenant', async () => {
    await applyInit();
    await applyMigration();
    await db.exec(INSERT_TENANT('t1'));
    await db.exec(INSERT_STATION);
    await db.exec(INSERT_TANK);
    await db.exec(INSERT_DEVICE);

    await db.exec(insertReading({ id: 'r1', tenantId: 't1', idempotencyKey: 'idem-abc' }));
    await expect(
      db.exec(insertReading({ id: 'r2', tenantId: 't1', idempotencyKey: 'idem-abc' })),
    ).rejects.toThrow(/duplicate key value|tank_readings_tenantId_idempotencyKey_key/i);
    await db.close();
  });

  it('lets a second tenant use the same key without touching the first tenant row', async () => {
    await applyInit();
    await applyMigration();
    await db.exec(INSERT_TENANT('t1'));
    await db.exec(INSERT_TENANT('t2'));
    await db.exec(INSERT_STATION);
    await db.exec(INSERT_TANK);
    await db.exec(INSERT_DEVICE);

    await db.exec(insertReading({ id: 'r1', tenantId: 't1', idempotencyKey: 'idem-shared' }));
    await db.exec(insertReading({ id: 'r2', tenantId: 't2', idempotencyKey: 'idem-shared' }));

    const result = await db.query<{ tenantId: string; idempotencyKey: string }>(
      `select "tenantId", "idempotencyKey" from tank_readings order by id`,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.tenantId)).toEqual(['t1', 't2']);
    await db.close();
  });

  it('rejects a reading with no idempotency key', async () => {
    await applyInit();
    await applyMigration();
    await db.exec(INSERT_TENANT('t1'));
    await db.exec(INSERT_STATION);
    await db.exec(INSERT_TANK);
    await db.exec(INSERT_DEVICE);

    await expect(
      db.exec(insertReading({ id: 'r1', tenantId: 't1', idempotencyKey: null })),
    ).rejects.toThrow(/null value in column "idempotencyKey"/i);
    await db.close();
  });

  it('has a rollback that restores the previous shape', async () => {
    await applyInit();
    await applyMigration();

    await db.exec(await readFile(join(MIGRATION_DIR, 'rollback.sql'), 'utf8'));

    const columns = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_name = 'tank_readings' and column_name = 'idempotencyKey'`,
    );
    expect(columns.rows[0]?.is_nullable).toBe('YES');

    const indexes = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'tank_readings' and indexdef ilike '%unique%'`,
    );
    const definitions = indexes.rows.map((row) => row.indexdef);
    expect(definitions.some((d) => d.includes('"deviceId", "idempotencyKey"'))).toBe(true);
    expect(definitions.some((d) => d.includes('"tenantId", "idempotencyKey"'))).toBe(false);
    await db.close();
  });
});
