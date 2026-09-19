import { tankCapacityLitres, type TankGeometry } from './geometry.js';
import type { SiteId, TankId, TenantId } from '../types/ids.js';

export const FUEL_PRODUCTS = ['diesel', 'petrol-91', 'petrol-95', 'kerosene', 'adblue'] as const;
export type FuelProduct = (typeof FUEL_PRODUCTS)[number];

export type TankStatus = 'active' | 'decommissioned';

/**
 * Per-tank alarm thresholds expressed as percentages of *usable* capacity
 * (0-100). Absolute millimetre values are derived from geometry so that a
 * threshold policy survives a tank replacement with different dimensions.
 */
export interface TankThresholds {
  /** At or below this percentage of capacity: critical low level. */
  readonly criticalLowPercent: number;
  /** At or below this percentage of capacity: low level warning. */
  readonly lowPercent: number;
  /** At or above this percentage of capacity: high level (overfill risk). */
  readonly highPercent: number;
  /** Water level in millimetres above which water ingress is reported. */
  readonly waterAlarmMm: number;
  /** Sustained product loss in litres per hour treated as theft or leak. */
  readonly rapidDropLitresPerHour: number;
  /** Volume rise in litres within `deliveryWindowMinutes` treated as a delivery. */
  readonly deliveryLitres: number;
  readonly deliveryWindowMinutes: number;
  /** Readings older than this many minutes are considered stale. */
  readonly staleAfterMinutes: number;
}

export const DEFAULT_TANK_THRESHOLDS: TankThresholds = {
  criticalLowPercent: 10,
  lowPercent: 20,
  highPercent: 95,
  waterAlarmMm: 50,
  rapidDropLitresPerHour: 400,
  deliveryLitres: 300,
  deliveryWindowMinutes: 30,
  staleAfterMinutes: 60,
};

export interface Tank {
  readonly id: TankId;
  readonly tenantId: TenantId;
  readonly siteId: SiteId;
  readonly name: string;
  readonly product: FuelProduct;
  readonly geometry: TankGeometry;
  /** Safe working capacity in litres (never exceeds geometric capacity). */
  readonly capacityLitres: number;
  readonly thresholds: TankThresholds;
  readonly status: TankStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function fillPercent(tank: Tank, netVolumeLitres: number): number {
  if (tank.capacityLitres <= 0) {
    return 0;
  }
  return (netVolumeLitres / tank.capacityLitres) * 100;
}

export function isTankActive(tank: Tank): boolean {
  return tank.status === 'active' && tank.capacityLitres > 0;
}

/**
 * Guards against a capacity that exceeds what the geometry can physically
 * hold, which would silently break every percentage based threshold.
 */
export function assertCapacityWithinGeometry(capacityLitres: number, geometry: TankGeometry): void {
  const geometric = tankCapacityLitres(geometry);
  if (capacityLitres > geometric + 0.5) {
    throw new RangeError(
      `capacityLitres ${capacityLitres} exceeds geometric capacity ${geometric.toFixed(2)}`,
    );
  }
}
