-- FuelTrack EA baseline schema.
--
-- Generated from prisma/schema.prisma. Verified to execute against PostgreSQL 18.
--
-- Data rules applied from TRD section 4:
--   * timestamps are timestamptz, stored in UTC
--   * litres, millimetres and degrees use numeric, never binary floating point
--   * readings keep both recorded_at and received_at
--   * device messages carry a unique idempotency key
--   * indexes follow the stated query patterns
--   * operational rows use lifecycle status instead of deletion

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('platform_admin', 'company_admin', 'station_manager', 'station_operator', 'auditor');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "TankStatus" AS ENUM ('active', 'decommissioned');

-- CreateEnum
CREATE TYPE "FuelProduct" AS ENUM ('diesel', 'petrol_91', 'petrol_95', 'kerosene', 'adblue');

-- CreateEnum
CREATE TYPE "DeviceProtocol" AS ENUM ('simulated', 'http', 'mqtt', 'modbus_rtu', 'modbus_tcp', 'other');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('registered', 'active', 'maintenance', 'retired');

-- CreateEnum
CREATE TYPE "DeviceConnectionState" AS ENUM ('online', 'offline', 'degraded');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('active', 'ended');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('measured', 'recorded', 'estimated', 'inferred', 'manual');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('ok', 'suspect', 'invalid');

-- CreateEnum
CREATE TYPE "FreshnessStatus" AS ENUM ('fresh', 'delayed', 'stale');

-- CreateEnum
CREATE TYPE "SourceProtocol" AS ENUM ('simulated', 'http', 'mqtt', 'manual');

-- CreateEnum
CREATE TYPE "FuelEventType" AS ENUM ('candidate_delivery', 'candidate_unexplained_decrease');

-- CreateEnum
CREATE TYPE "FuelEventStatus" AS ENUM ('candidate', 'confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('low_stock', 'critical_stock', 'device_offline', 'stale_data', 'probe_quality', 'candidate_delivery', 'candidate_unexplained_decrease', 'water_level');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'device', 'system');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "country" TEXT NOT NULL DEFAULT 'TZ',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'station_operator',
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
    "status" "StationStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_station_scopes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_station_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tanks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" "FuelProduct" NOT NULL,
    "status" "TankStatus" NOT NULL DEFAULT 'active',
    "capacityLitres" DECIMAL(14,3) NOT NULL,
    "geometry" JSONB NOT NULL,
    "calibrationSource" TEXT,
    "calibrationAt" TIMESTAMPTZ(3),
    "strappingTable" JSONB,
    "criticalLowPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "lowPercent" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "highPercent" DECIMAL(5,2) NOT NULL DEFAULT 95,
    "waterAlarmMm" DECIMAL(10,2) NOT NULL DEFAULT 50,
    "unexplainedDecreaseLitresPerHour" DECIMAL(12,3) NOT NULL DEFAULT 400,
    "deliveryMinLitres" DECIMAL(14,3) NOT NULL DEFAULT 300,
    "deliveryWindowMinutes" INTEGER NOT NULL DEFAULT 30,
    "staleAfterMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "protocol" "DeviceProtocol" NOT NULL DEFAULT 'other',
    "firmwareVersion" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'registered',
    "connectionState" "DeviceConnectionState" NOT NULL DEFAULT 'offline',
    "lastSeenAt" TIMESTAMPTZ(3),
    "credentialRef" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'active',
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tank_readings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "deviceId" TEXT,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "levelMm" DECIMAL(10,2) NOT NULL,
    "waterLevelMm" DECIMAL(10,2),
    "volumeLitres" DECIMAL(14,3) NOT NULL,
    "temperatureC" DECIMAL(5,2),
    "provenance" "Provenance" NOT NULL DEFAULT 'measured',
    "qualityStatus" "QualityStatus" NOT NULL DEFAULT 'ok',
    "freshnessStatus" "FreshnessStatus" NOT NULL DEFAULT 'fresh',
    "sourceProtocol" "SourceProtocol" NOT NULL DEFAULT 'http',
    "idempotencyKey" TEXT,
    "rawMessageId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tank_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_device_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT,
    "protocol" "SourceProtocol" NOT NULL DEFAULT 'http',
    "payload" JSONB NOT NULL,
    "messageHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_device_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "type" "FuelEventType" NOT NULL,
    "status" "FuelEventStatus" NOT NULL DEFAULT 'candidate',
    "confidence" DECIMAL(4,3) NOT NULL,
    "volumeChangeLitres" DECIMAL(14,3) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "notes" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fuel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "fuelEventId" TEXT,
    "volumeLitres" DECIMAL(14,3) NOT NULL,
    "reference" TEXT,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tankId" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "message" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "raisedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(3),
    "acknowledgedByUserId" TEXT,
    "assignedToUserId" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedByUserId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorDeviceId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipHash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_createdAt_idx" ON "tenants"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "users_tenantId_createdAt_idx" ON "users"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_station_scopes_userId_stationId_key" ON "user_station_scopes"("userId", "stationId");

-- CreateIndex
CREATE INDEX "user_station_scopes_tenantId_stationId_idx" ON "user_station_scopes"("tenantId", "stationId");

-- CreateIndex
CREATE UNIQUE INDEX "stations_tenantId_code_key" ON "stations"("tenantId", "code");

-- CreateIndex
CREATE INDEX "stations_tenantId_createdAt_idx" ON "stations"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tanks_tenantId_createdAt_idx" ON "tanks"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tanks_stationId_status_idx" ON "tanks"("stationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenantId_serialNumber_key" ON "devices"("tenantId", "serialNumber");

-- CreateIndex
CREATE INDEX "devices_tenantId_createdAt_idx" ON "devices"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "devices_connectionState_lastSeenAt_idx" ON "devices"("connectionState", "lastSeenAt");

-- CreateIndex
CREATE INDEX "device_assignments_tankId_status_idx" ON "device_assignments"("tankId", "status");

-- CreateIndex
CREATE INDEX "device_assignments_deviceId_status_idx" ON "device_assignments"("deviceId", "status");

-- CreateIndex
CREATE INDEX "device_assignments_tenantId_createdAt_idx" ON "device_assignments"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tank_readings_deviceId_idempotencyKey_key" ON "tank_readings"("deviceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "tank_readings_tankId_recordedAt_idx" ON "tank_readings"("tankId", "recordedAt");

-- CreateIndex
CREATE INDEX "tank_readings_tenantId_createdAt_idx" ON "tank_readings"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tank_readings_tankId_qualityStatus_recordedAt_idx" ON "tank_readings"("tankId", "qualityStatus", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "raw_device_messages_tenantId_messageHash_key" ON "raw_device_messages"("tenantId", "messageHash");

-- CreateIndex
CREATE INDEX "raw_device_messages_tenantId_receivedAt_idx" ON "raw_device_messages"("tenantId", "receivedAt");

-- CreateIndex
CREATE INDEX "fuel_events_tenantId_createdAt_idx" ON "fuel_events"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "fuel_events_tankId_status_windowStart_idx" ON "fuel_events"("tankId", "status", "windowStart");

-- CreateIndex
CREATE INDEX "deliveries_tenantId_confirmedAt_idx" ON "deliveries"("tenantId", "confirmedAt");

-- CreateIndex
CREATE INDEX "deliveries_tankId_confirmedAt_idx" ON "deliveries"("tankId", "confirmedAt");

-- CreateIndex
CREATE INDEX "alerts_tenantId_status_raisedAt_idx" ON "alerts"("tenantId", "status", "raisedAt");

-- CreateIndex
CREATE INDEX "alerts_tankId_status_idx" ON "alerts"("tankId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_occurredAt_idx" ON "audit_logs"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_station_scopes" ADD CONSTRAINT "user_station_scopes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_station_scopes" ADD CONSTRAINT "user_station_scopes_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tanks" ADD CONSTRAINT "tanks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tanks" ADD CONSTRAINT "tanks_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "tanks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "tanks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_readings" ADD CONSTRAINT "tank_readings_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_device_messages" ADD CONSTRAINT "raw_device_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_device_messages" ADD CONSTRAINT "raw_device_messages_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_events" ADD CONSTRAINT "fuel_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_events" ADD CONSTRAINT "fuel_events_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "tanks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "tanks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_fuelEventId_fkey" FOREIGN KEY ("fuelEventId") REFERENCES "fuel_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "tanks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
