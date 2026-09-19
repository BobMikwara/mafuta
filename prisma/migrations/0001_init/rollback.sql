-- Rollback for 0001_init.
--
-- Prisma does not apply rollback files automatically. This file is the
-- documented reverse step and is verified by prisma/test/migration.test.ts.
--
-- Run manually only when you intend to destroy the baseline schema and all
-- data in it:
--   psql "$DATABASE_URL" -f prisma/migrations/0001_init/rollback.sql
--
-- Take a backup first. This is irreversible.

DROP TABLE IF EXISTS "alerts" CASCADE;
DROP TABLE IF EXISTS "audit_logs" CASCADE;
DROP TABLE IF EXISTS "deliveries" CASCADE;
DROP TABLE IF EXISTS "fuel_events" CASCADE;
DROP TABLE IF EXISTS "raw_device_messages" CASCADE;
DROP TABLE IF EXISTS "tank_readings" CASCADE;
DROP TABLE IF EXISTS "device_assignments" CASCADE;
DROP TABLE IF EXISTS "devices" CASCADE;
DROP TABLE IF EXISTS "tanks" CASCADE;
DROP TABLE IF EXISTS "user_station_scopes" CASCADE;
DROP TABLE IF EXISTS "stations" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "tenants" CASCADE;

DROP TYPE IF EXISTS "ActorType";
DROP TYPE IF EXISTS "AlertStatus";
DROP TYPE IF EXISTS "AlertSeverity";
DROP TYPE IF EXISTS "AlertType";
DROP TYPE IF EXISTS "FuelEventStatus";
DROP TYPE IF EXISTS "FuelEventType";
DROP TYPE IF EXISTS "SourceProtocol";
DROP TYPE IF EXISTS "FreshnessStatus";
DROP TYPE IF EXISTS "QualityStatus";
DROP TYPE IF EXISTS "Provenance";
DROP TYPE IF EXISTS "AssignmentStatus";
DROP TYPE IF EXISTS "DeviceConnectionState";
DROP TYPE IF EXISTS "DeviceStatus";
DROP TYPE IF EXISTS "DeviceProtocol";
DROP TYPE IF EXISTS "FuelProduct";
DROP TYPE IF EXISTS "TankStatus";
DROP TYPE IF EXISTS "StationStatus";
DROP TYPE IF EXISTS "UserStatus";
DROP TYPE IF EXISTS "UserRole";
DROP TYPE IF EXISTS "TenantStatus";
