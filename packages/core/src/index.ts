/**
 * FuelTrack EA core: vendor-agnostic domain, ports, validation, simulator,
 * alert and event rules, and services. Nothing in this package depends on a
 * database, a cloud provider or a tank gauge vendor.
 */

export * from './types/ids.js';
export * from './types/result.js';
export * from './errors.js';

export * from './logging/logger.js';
export * from './ports/clock.js';
export * from './ports/repositories.js';
export * from './ports/tank-gauge-adapter.js';

export * from './domain/quantity.js';
export * from './domain/geometry.js';
export * from './domain/station.js';
export * from './domain/tank.js';
export * from './domain/reading.js';
export * from './domain/freshness.js';
export * from './domain/alert.js';
export * from './domain/event.js';
export * from './domain/delivery.js';
export * from './domain/device.js';
export * from './domain/audit.js';
export * from './domain/views.js';
export * from './domain/normalize.js';
export * from './domain/idempotency.js';

export * from './tenancy/tenant-context.js';
export * from './tenancy/api-key.js';
export * from './tenancy/scopes.js';
export * from './tenancy/credential-health.js';
export * from './tenancy/guard.js';
export * from './tenancy/rate-limit.js';
export * from './tenancy/ip-hash.js';

export * from './alerts/alert-engine.js';
export * from './events/detection.js';
export * from './reporting/report-table.js';

export * from './validation/schemas.js';

export * from './services/audit-service.js';
export * from './services/fleet-service.js';
export * from './services/device-service.js';
export * from './services/event-service.js';
export * from './services/ingest-service.js';
export * from './services/dashboard-service.js';
export * from './services/report-service.js';
export * from './services/alert-sweep-service.js';

export * from './adapters/memory/memory-store.js';
export * from './adapters/memory/memory-repositories.js';
export * from './adapters/memory/memory-api-key-registry.js';
export * from './adapters/prisma/client.js';
export * from './adapters/prisma/migrate.js';
export * from './adapters/prisma/pg-migrate.js';
export * from './adapters/prisma/prisma-repositories.js';
export * from './adapters/prisma/prisma-api-key-registry.js';

export * from './simulator/rng.js';
export * from './simulator/scenarios.js';
export * from './simulator/tank-simulator.js';
export * from './simulator/simulated-tank-gauge-adapter.js';
