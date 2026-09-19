-- Idempotency hardening for tank readings.
--
-- The application now derives a submission identity for every reading, so the
-- column becomes mandatory and the uniqueness moves from (deviceId,
-- idempotencyKey) to (tenantId, idempotencyKey).
--
-- Scoping by tenant instead of device matters because PostgreSQL treats NULL as
-- distinct: the previous index could not protect a manual dip recorded without
-- a device, which is exactly the row a duplicate would create. The tenant is
-- part of the derived key, so per device uniqueness still holds by construction.

-- Backfill any row written before the application always derived a key. The
-- value only has to be unique and opaque, so the primary key is sufficient.
UPDATE "tank_readings"
SET "idempotencyKey" = 'idem_legacy_' || md5("id")
WHERE "idempotencyKey" IS NULL;

DROP INDEX IF EXISTS "tank_readings_deviceId_idempotencyKey_key";

ALTER TABLE "tank_readings" ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "tank_readings_tenantId_idempotencyKey_key"
    ON "tank_readings"("tenantId", "idempotencyKey");
