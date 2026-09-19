# Database and migrations

PostgreSQL with Prisma. The schema in `schema.prisma` is the source of truth.

## Layout

```
prisma/
  schema.prisma                     Source of truth for the data model.
  migrations/
    migration_lock.toml             Declares the provider. Do not edit by hand.
    0001_init/
      migration.sql                 Baseline schema.
      rollback.sql                  Reverse step, applied manually.
    0002_idempotency_key/
      migration.sql                 Mandatory, tenant scoped idempotency key.
      rollback.sql                  Reverse step, applied manually.
  test/
    migration.test.ts               Applies the baseline to a real PostgreSQL
                                    instance through PGlite and asserts the
                                    TRD data rules.
    idempotency-migration.test.ts   Applies 0001 then 0002 and asserts the
                                    duplicate and cross-tenant behaviour.
```

## Local setup

```bash
docker compose -f infra/docker-compose.yml up -d
export DATABASE_URL="postgresql://fueltrack:fueltrack@localhost:5432/fueltrack_dev?schema=public"
npm run db:generate     # generates the typed client into node_modules
npm run db:deploy       # applies committed migrations
```

The schema and the migration tests run without Docker: `npm run db:test` uses
PGlite, which is PostgreSQL compiled to WebAssembly and runs in process.

## Changing the schema

1. Edit `schema.prisma`.
2. Create a migration: `npm run db:migrate -- --name describe_the_change`
3. Review the generated SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`.
4. Write the reverse step into `rollback.sql` in the same folder.
5. Commit the schema, the migration, and the rollback together.
6. Run `npm run db:test` and `npm run db:drift`.

## Verifying there is no drift

The committed migrations must produce exactly the schema:

```bash
export SHADOW_DATABASE_URL="postgresql://fueltrack:fueltrack@localhost:5433/fueltrack_shadow?schema=public"
npm run db:drift
```

A non-zero exit means the migrations and the schema disagree. CI runs this
check against a PostgreSQL service container.

## Rollback

Prisma does not apply rollback files. To reverse a migration, apply its
`rollback.sql` by hand in reverse order:

```bash
psql "$DATABASE_URL" -f prisma/migrations/0002_idempotency_key/rollback.sql
psql "$DATABASE_URL" -f prisma/migrations/0001_init/rollback.sql
```

Take a backup first. The `0001_init` rollback drops tables and types, and it
destroys data. The `0002` rollback only relaxes a column and swaps an index, and
it leaves the backfilled key values in place, which is harmless because they are
opaque identifiers.

## Rules this schema follows

From TRD section 4:

- Timestamps are `timestamptz`, stored in UTC.
- Litres, millimetres and degrees use `numeric`, never binary floating point.
  Volumes are `numeric(14,3)`, which is exact and avoids inventory drift.
- Readings keep both `recordedAt` (device clock) and `receivedAt` (server clock).
- Device messages carry a unique `idempotencyKey` per device.
- Indexes follow the stated query patterns: `tankId + recordedAt` and
  `tenantId + createdAt`.
- Operational entities use lifecycle status columns instead of hard deletion.
- Raw device payloads live in `raw_device_messages` and are access restricted.

## Verification status

`0001_init` was executed against PostgreSQL 18 and produces 13 tables, 20 enum
types and 43 indexes. `0002_idempotency_key` was executed on top of it. The
assertions in `test/migration.test.ts` cover the decimal types, both timestamps,
tenant cascades, cross-tenant rejection at the foreign key level, and the
rollback. `test/idempotency-migration.test.ts` covers the mandatory key, the
backfill of rows written before it was mandatory, duplicate rejection within a
tenant, isolation between tenants, and the `0002` rollback.

The Prisma CLI engine binaries could not be downloaded in the environment where
this baseline was written, so `prisma validate` and `prisma migrate diff` have
not been executed here. Run `npm run db:validate` and `npm run db:drift` in an
environment with network access to the Prisma binaries before relying on this
baseline, and regenerate `0001_init` with `prisma migrate dev` if the CLI
reports any difference.
