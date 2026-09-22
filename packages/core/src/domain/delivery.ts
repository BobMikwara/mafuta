import type { FuelEventId, StationId, TankId, TenantId } from '../types/ids.js';

/**
 * A confirmed fuel delivery.
 *
 * A delivery is created only when a human confirms a `candidate_delivery`
 * event. It carries two volumes, and they are deliberately kept apart:
 *
 *   - `measuredVolumeMl`: what the tank probe observed across the event window
 *     (a measured value),
 *   - `recordedVolumeMl`: what the operator or supplier docket states was
 *     delivered (a recorded value).
 *
 * Reconciliation compares the two. The difference is a variance to explain, not
 * evidence of wrongdoing.
 */
export interface Delivery {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly tankId: TankId;
  readonly fuelEventId: FuelEventId | null;
  /** Volume observed by the probe, integer millilitres. */
  readonly measuredVolumeMl: number;
  /** Volume stated by the operator or supplier, integer millilitres. */
  readonly recordedVolumeMl: number;
  /** Supplier docket, invoice or transfer note reference. */
  readonly reference: string | null;
  readonly supplier: string | null;
  /** Who confirmed it. An API key principal or user reference, never a secret. */
  readonly confirmedBy: string;
  readonly confirmedAt: string;
  readonly createdAt: string;
}

/** Signed difference between what was recorded and what was measured. */
export function deliveryVarianceMl(delivery: Delivery): number {
  return delivery.recordedVolumeMl - delivery.measuredVolumeMl;
}

/** Variance as a percentage of the recorded volume, or null when none stated. */
export function deliveryVariancePercent(delivery: Delivery): number | null {
  if (delivery.recordedVolumeMl === 0) {
    return null;
  }
  return (deliveryVarianceMl(delivery) / delivery.recordedVolumeMl) * 100;
}

/** A delivery with the tank and station context needed by list views. */
export interface DeliveryWithContext {
  readonly delivery: Delivery;
  readonly tankName: string;
  readonly stationId: StationId;
  readonly stationName: string;
  readonly product: string;
  readonly varianceMl: number;
  readonly variancePercent: number | null;
}
