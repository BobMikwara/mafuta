import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies the baseline migration to a real PostgreSQL instance. PGlite runs
 * compiled PostgreSQL in process, so these assertions need no server and no
 * Docker, and they run in CI.
 *
 * The tests protect the invariants that are easy to break by accident:
 * decimal litres instead of floating point, UTC timestamps, both device and
 * server timestamps, idempotency keys, and tenant scoped indexes.
 */
const MIGRATION_DIR = join(process.cwd(), 'prisma', 'migrations', '0001_init');

interface ColumnInfo {
  column_name: string;
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: string;
}

const INSERT_TENANT = `insert into tenants (id, name, slug, "updatedAt") values ('t1', 'Test Tenant', 'test-tenant', now())`;

const INSERT_STATION = `insert into stations (id, "tenantId", name, code, "updatedAt")
  values ('s1', 't1', 'Test Station', 'TS1', now())`;

const INSERT_TANK = `insert into tanks (id, "tenantId", "stationId", name, product, "capacityLitres", geometry, "updatedAt")
  values ('tk1', 't1', 's1', 'Diesel Tank 1', 'diesel', 19000.000, '{"kind":"vertical-cylinder"}', now())`;

const INSERT_DEVICE = `insert into devices (id, "tenantId", manufacturer, model, "serialNumber", "updatedAt")
  values ('d1', 't1', 'Acme', 'Probe', 'SN-1', now())`;

function insertReading(id: string, idempotencyKey: string | null): string {
  const key = idempotencyKey === null ? 'NULL' : `'${idempotencyKey}'`;
  return `insert into tank_readings
    (id, "tenantId", "tankId", "deviceId", "recordedAt", "receivedAt", "levelMm", "volumeLitres", "idempotencyKey")
    values ('${id}', 't1', 'tk1', 'd1', now(), now(), 1000.00, 4908.739, ${key})`;
}

describe('baseline migration', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create();
    const sql = await readFile(join(MIGRATION_DIR, 'migration.sql'), 'utf8');
    await db.exec(sql);
  });

  it('creates every domain table named in the TRD', async () => {
    const result = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      'alerts',
      'audit_logs',
      'deliveries',
      'device_assignments',
      'devices',
      'fuel_events',
      'raw_device_messages',
      'stations',
      'tank_readings',
      'tanks',
      'tenants',
      'user_station_scopes',
      'users',
    ]);
    await db.close();
  });

  it('stores litres and levels as numeric, never floating point', async () => {
    const result = await db.query<ColumnInfo & { table_name: string }>(
      `select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable
       from information_schema.columns
       where (table_name = 'tank_readings' and column_name in ('volumeLitres', 'levelMm', 'waterLevelMm', 'temperatureC'))
          or (table_name = 'tanks' and column_name = 'capacityLitres')
       order by table_name, column_name`,
    );

    const descriptions = result.rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(descriptions).toEqual([
      'tank_readings.levelMm',
      'tank_readings.temperatureC',
      'tank_readings.volumeLitres',
      'tank_readings.waterLevelMm',
      'tanks.capacityLitres',
    ]);
    for (const column of result.rows) {
      expect(column.data_type).toBe('numeric');
    }

    const volume = result.rows.find((row) => row.column_name === 'volumeLitres');
    expect(volume?.numeric_precision).toBe(14);
    expect(volume?.numeric_scale).toBe(3);
    await db.close();
  });

  it('rounds decimal litres exactly, which binary floating point would not', async () => {
    await db.exec(INSERT_TENANT);
    await db.exec(INSERT_STATION);
    await db.exec(INSERT_TANK);
    await db.exec(INSERT_DEVICE);
    await db.exec(insertReading('r1', null));

    const result = await db.query<{ volume_litres: string }>(
      `select "volumeLitres" as volume_litres from tank_readings where id = 'r1'`,
    );
    // numeric returns the exact decimal as text, with no float drift.
    expect(result.rows[0]?.volume_litres).toBe('4908.739');
    await db.close();
  });

  it('keeps both the device timestamp and the server receipt timestamp as timestamptz', async () => {
    const result = await db.query<ColumnInfo>(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_name = 'tank_readings' and column_name in ('recordedAt', 'receivedAt')
       order by column_name`,
    );

    expect(result.rows.map((row) => row.column_name)).toEqual(['receivedAt', 'recordedAt']);
    for (const column of result.rows) {
      expect(column.data_type).toBe('timestamp with time zone');
      expect(column.is_nullable).toBe('NO');
    }
    await db.close();
  });

  it('enforces idempotency with a unique key per device', async () => {
    const indexResult = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where tablename = 'tank_readings' and indexname = 'tank_readings_deviceId_idempotencyKey_key'`,
    );
    expect(indexResult.rows[0]?.indexdef).toContain('UNIQUE');

    await db.exec(INSERT_TENANT);
    await db.exec(INSERT_STATION);
    await db.exec(INSERT_TANK);
    await db.exec(INSERT_DEVICE);

    await db.exec(insertReading('r1', 'msg-1'));
    await expect(db.exec(insertReading('r2', 'msg-1'))).rejects.toThrow();

    // Distinct keys for the same device are allowed.
    await db.exec(insertReading('r3', 'msg-2'));
    const count = await db.query<{ total: string }>(
      `select count(*)::text as total from tank_readings`,
    );
    expect(count.rows[0]?.total).toBe('2');
    await db.close();
  });

  it('creates the tenant and tank query indexes', async () => {
    const result = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'`,
    );
    const names = result.rows.map((row) => row.indexname);
    expect(names).toContain('tank_readings_tankId_recordedAt_idx');
    expect(names).toContain('tank_readings_tenantId_createdAt_idx');
    expect(names).toContain('tenants_status_createdAt_idx');
    expect(names).toContain('tanks_tenantId_createdAt_idx');
    expect(names).toContain('raw_device_messages_tenantId_messageHash_key');
    await db.close();
  });

  it('cascades tenant deletion to tenant owned rows', async () => {
    await db.exec(INSERT_TENANT);
    await db.exec(INSERT_STATION);
    await db.exec(`delete from tenants where id = 't1'`);
    const result = await db.query<{ total: string }>(
      `select count(*)::text as total from stations`,
    );
    expect(result.rows[0]?.total).toBe('0');
    await db.close();
  });

  it('rejects a reading whose tenant does not own the tank', async () => {
    await db.exec(INSERT_TENANT);
    await db.exec(INSERT_STATION);
    await db.exec(INSERT_TANK);

    await expect(
      db.exec(
        `insert into tank_readings (id, "tenantId", "tankId", "recordedAt", "receivedAt", "levelMm", "volumeLitres")
         values ('r-bad', 'tenant-other', 'tk1', now(), now(), 100.00, 100.000)`,
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it('has a verified rollback that removes every object it created', async () => {
    const rollback = await readFile(join(MIGRATION_DIR, 'rollback.sql'), 'utf8');
    await db.exec(rollback);

    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const types = await db.query<{ typname: string }>(
      `select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where t.typtype = 'e' and n.nspname = 'public'`,
    );

    expect(tables.rows).toHaveLength(0);
    expect(types.rows).toHaveLength(0);
    await db.close();
  });
});
