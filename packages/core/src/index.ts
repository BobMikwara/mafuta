/**
 * FuelTrack EA core: vendor-agnostic domain, ports, validation, simulator and
 * alarm rules. Nothing in this package depends on a database, a cloud provider
 * or a tank gauge vendor.
 */

export * from './types/ids.js';
export * from './types/result.js';
export * from './errors.js';

export * from './logging/logger.js';
export * from './ports/clock.js';
export * from './ports/repositories.js';
export * from './ports/tank-gauge-adapter.js';

export * from './domain/geometry.js';
export * from './domain/site.js';
export * from './domain/tank.js';
export * from './domain/reading.js';
export * from './domain/alarm.js';
export * from './domain/normalize.js';

export * from './tenancy/tenant-context.js';
export * from './tenancy/api-key.js';
export * from './tenancy/credential-health.js';
export * from './tenancy/guard.js';

export * from './alarms/alarm-engine.js';

export * from './validation/schemas.js';

export * from './services/ingest-service.js';
export * from './services/fleet-service.js';

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
