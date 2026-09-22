import { isMillilitres, litresToMl, type Millilitres } from './quantity.js';
import type { ReadingId, TankId, TenantId } from '../types/ids.js';

/**
 * Where a reading came from. `simulated` is propagated end to end so that no
 * simulated value can ever be mistaken for a real device measurement in
 * reports, reconciliation or billing.
 */
export type ReadingSource = 'simulated' | 'device' | 'manual';

/**
 * How a value was obtained (TRD section 3, `Provenance`).
 *
 *   measured  - reported by a probe or gauge
 *   recorded  - entered by a person from a docket or a manual dip
 *   estimated - derived from a geometry or a model rather than observed
 *   inferred  - produced by a rule, such as a reconciled delivery volume
 *   manual    - entered by a person without a source document
 */
export const READING_PROVENANCES = [
  'measured',
  'recorded',
  'estimated',
  'inferred',
  'manual',
] as const;
export type ReadingProvenance = (typeof READING_PROVENANCES)[number];

export type ReadingQuality = 'ok' | 'suspect' | 'invalid';

/** Computed freshness. Never stored as truth: recomputed on every read. */
export type ReadingFreshness = 'fresh' | 'delayed' | 'stale';

export type SourceProtocol = 'simulated' | 'http' | 'mqtt' | 'manual';

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
  /** Gross volume including water, in litres, stored at three decimals. */
  readonly grossVolumeLitres: number;
  /** Gross volume minus water volume, in litres, stored at three decimals. */
  readonly netVolumeLitres: number;
  /** Product temperature in degrees Celsius, nullable when unsupported. */
  readonly temperatureC: number | null;
  readonly source: ReadingSource;
  readonly quality: ReadingQuality;
  readonly provenance: ReadingProvenance;
  readonly sourceProtocol: SourceProtocol;
  /** Freshness at the time the row was written. Recomputed on read. */
  readonly freshness: ReadingFreshness;
  /** Optional 0-100 signal quality reported by the probe. */
  readonly signalQualityPercent: number | null;
  /** Identifier of the physical probe, null for manual and simulated entries. */
  readonly deviceId: string | null;
  /** Access restricted raw payload this reading was normalized from. */
  readonly rawMessageId: string | null;
  /** Why a reading was judged suspect or invalid. Null when quality is `ok`. */
  readonly qualityReason: string | null;
  /**
   * Submission identity. Supplied by the device, otherwise derived from
   * tenant, tank, device and observation time. Resubmitting the same
   * observation returns the original reading instead of creating a second one.
   */
  readonly idempotencyKey: string;
}

/**
 * Exact millilitre view of a reading. Conversion is safe because volumes are
 * persisted with three decimals, so the multiplication is exact and no
 * inventory arithmetic ever runs on binary floating point.
 */
export function grossVolumeMl(reading: TankReading): Millilitres {
  return litresToMl(reading.grossVolumeLitres);
}

export function netVolumeMl(reading: TankReading): Millilitres {
  return litresToMl(reading.netVolumeLitres);
}

/** Validates the unit invariant where a reading crosses a boundary. */
export function hasIntegerVolumes(reading: TankReading): boolean {
  return isMillilitres(grossVolumeMl(reading)) && isMillilitres(netVolumeMl(reading));
}

export function provenanceForSource(source: ReadingSource): ReadingProvenance {
  if (source === 'device') return 'measured';
  if (source === 'simulated') return 'measured';
  return 'manual';
}

export function sourceProtocolForSource(source: ReadingSource): SourceProtocol {
  if (source === 'simulated') return 'simulated';
  if (source === 'manual') return 'manual';
  return 'http';
}
