import {
  DEFAULT_TANK_THRESHOLDS,
  toStationId,
  toTankId,
  toTenantId,
  type Tank,
} from '@fueltrack/core';

/**
 * Builds a tank definition equivalent to the one the API returns, so runner
 * tests do not depend on a live server.
 */
export function makeTankLike(id = 'tank-1'): Tank {
  return {
    id: toTankId(id),
    tenantId: toTenantId('tenant-a'),
    stationId: toStationId('station-1'),
    name: `Tank ${id}`,
    product: 'diesel',
    geometry: { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
    capacityLitres: 19_000,
    thresholds: DEFAULT_TANK_THRESHOLDS,
    status: 'active',
    calibrationSource: null,
    calibrationAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

export { createMemoryLogSink, createLogger, fixedClock } from '@fueltrack/core';
export type { ProbeSample, Tank } from '@fueltrack/core';
