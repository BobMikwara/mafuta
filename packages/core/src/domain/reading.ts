import type { ReadingId, TankId, TenantId } from '../types/ids.js';

/**
 * Where a reading came from. `simulated` is propagated end to end so that no
 * simulated value can ever be mistaken for a real device measurement in
 * reports, reconciliation or billing.
 */
export type ReadingSource = 'simulated' | 'device' | 'manual';

export type ReadingQuality = 'ok' | 'suspect' | 'invalid';

export interface TankReading {
  readonly id: ReadingId;
  readonly tenantId: TenantId;
  readonly tankId: TankId;
  /** Timestamp reported by the probe (ISO 8601, UTC). */
  readonly recordedAt: string;
  /** Timestamp at which the platform persisted the reading (ISO 8601, UTC). */
  readonly receivedAt: string;
  /** Product level from the bottom of the tank, in millimetres. */
  readonly levelMm: number;
  /** Free water level from the bottom of the tank, in millimetres. */
  readonly waterLevelMm: number;
  /** Gross volume including water, in litres. */
  readonly grossVolumeLitres: number;
  /** Gross volume minus water volume, in litres. */
  readonly netVolumeLitres: number;
  /** Product temperature in degrees Celsius, nullable for probes without a sensor. */
  readonly temperatureC: number | null;
  readonly source: ReadingSource;
  readonly quality: ReadingQuality;
  /** Identifier of the physical probe, null for manual and simulated entries. */
  readonly deviceId: string | null;
}
