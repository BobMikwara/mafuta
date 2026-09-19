-- Reverse step for 0002_idempotency_key.
--
-- The values backfilled by the forward migration remain, which is harmless: an
-- idempotency key is an opaque identifier and the backfilled values stay
-- unique because they are derived from the primary key.

DROP INDEX IF EXISTS "tank_readings_tenantId_idempotencyKey_key";

ALTER TABLE "tank_readings" ALTER COLUMN "idempotencyKey" DROP NOT NULL;

CREATE UNIQUE INDEX "tank_readings_deviceId_idempotencyKey_key"
    ON "tank_readings"("deviceId", "idempotencyKey");
