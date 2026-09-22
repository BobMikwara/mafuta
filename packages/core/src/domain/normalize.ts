import { deriveIdempotencyKey } from './idempotency.js';
import { maxLevelMm, volumeAtLevelLitres } from './geometry.js';
import { roundLevelMm } from './quantity.js';
import { provenanceForSource, sourceProtocolForSource, type TankReading } from './reading.js';
import { computeFreshness, DEFAULT_DELAYED_AFTER_MINUTES } from './freshness.js';
import type { Tank } from './tank.js';
import type { ReadingQuality } from './reading.js';
import type { ReadingId, TankId } from '../types/ids.js';
import { newId } from '../types/ids.js';

/**
 * A raw sample as produced by a tank gauge adapter or a manual entry.
 *
 * Adapters never invent volumes: they report physical observations, and this
 * normalizer converts them into domain readings using the tank geometry.
 */
export interface ProbeSample {
  readonly tankId: TankId;
  readonly observedAt: string;
  readonly levelMm: number;
  readonly waterLevelMm: number;
  readonly temperatureC: number | null;
  readonly deviceId: string | null;
  readonly source: TankReading['source'];
  /** Optional 0-100 signal quality reported by the probe. */
  readonly signalQualityPercent?: number;
  /**
   * Submission identity supplied by the client. When absent the platform
   * derives one from the sample itself, which makes an unkeyed retry of the
   * same observation collapse onto the original reading.
   */
  readonly idempotencyKey?: string;
}

export interface NormalizeContext {
  readonly tenantId: TankReading['tenantId'];
  readonly receivedAt: string;
  readonly readingId?: ReadingId;
  /** Overrides the derived idempotency key. Used when the caller computed it. */
  readonly idempotencyKey?: string;
  /** Access restricted raw payload this reading was produced from. */
  readonly rawMessageId?: string | null;
  /** Overrides the default delayed-after window used for freshness. */
  readonly delayedAfterMinutes?: number;
}

const SIGNAL_QUALITY_SUSPECT_PERCENT = 40;

export interface QualityVerdict {
  readonly quality: ReadingQuality;
  readonly reason: string | null;
}

/**
 * Validity and plausibility rules. Impossible values are `invalid` and are kept
 * out of every calculation; values that are physically possible but doubtful
 * are `suspect` and are kept, clearly labelled, because silently dropping them
 * would hide a failing probe.
 */
export function classifyProbeSample(tank: Tank, sample: ProbeSample): QualityVerdict {
  const { levelMm, waterLevelMm, signalQualityPercent } = sample;
  if (!Number.isFinite(levelMm) || !Number.isFinite(waterLevelMm)) {
    return { quality: 'invalid', reason: 'level is not a finite number' };
  }
  if (levelMm < 0 || waterLevelMm < 0) {
    return { quality: 'invalid', reason: 'negative level' };
  }
  if (waterLevelMm > levelMm) {
    return { quality: 'invalid', reason: 'water level above product level' };
  }
  if (levelMm > maxLevelMm(tank.geometry)) {
    return {
      quality: 'invalid',
      reason: `level exceeds the maximum measurable level of ${maxLevelMm(tank.geometry)} mm`,
    };
  }
  if (temperatureOutOfRange(sample.temperatureC)) {
    return { quality: 'suspect', reason: 'temperature outside the supported range' };
  }
  if (signalQualityPercent !== undefined && signalQualityPercent < SIGNAL_QUALITY_SUSPECT_PERCENT) {
    return {
      quality: 'suspect',
      reason: `signal quality ${signalQualityPercent}% below ${SIGNAL_QUALITY_SUSPECT_PERCENT}%`,
    };
  }
  return { quality: 'ok', reason: null };
}

function temperatureOutOfRange(temperatureC: number | null): boolean {
  if (temperatureC === null) {
    return false;
  }
  return !Number.isFinite(temperatureC) || temperatureC < -60 || temperatureC > 120;
}

export function normalizeProbeSample(
  tank: Tank,
  sample: ProbeSample,
  context: NormalizeContext,
): TankReading {
  const verdict = classifyProbeSample(tank, sample);
  const safeLevelMm = Number.isFinite(sample.levelMm) ? Math.max(0, sample.levelMm) : 0;
  const safeWaterLevelMm = Number.isFinite(sample.waterLevelMm)
    ? Math.max(0, Math.min(sample.waterLevelMm, safeLevelMm))
    : 0;

  const grossVolumeLitres = roundLitres3(volumeAtLevelLitres(tank.geometry, safeLevelMm));
  const waterVolumeLitres = roundLitres3(volumeAtLevelLitres(tank.geometry, safeWaterLevelMm));
  const netVolumeLitres = roundLitres3(Math.max(0, grossVolumeLitres - waterVolumeLitres));

  const receivedAt = context.receivedAt;
  const reading: TankReading = {
    id: context.readingId ?? (newId('rdg') as ReadingId),
    tenantId: context.tenantId,
    tankId: tank.id,
    recordedAt: sample.observedAt,
    receivedAt,
    levelMm: roundLevelMm(safeLevelMm),
    waterLevelMm: roundLevelMm(safeWaterLevelMm),
    grossVolumeLitres,
    netVolumeLitres,
    temperatureC: sample.temperatureC,
    source: sample.source,
    quality: verdict.quality,
    provenance: provenanceForSource(sample.source),
    sourceProtocol: sourceProtocolForSource(sample.source),
    freshness: 'fresh',
    signalQualityPercent: sample.signalQualityPercent ?? null,
    deviceId: sample.deviceId,
    rawMessageId: context.rawMessageId ?? null,
    qualityReason: verdict.reason,
    idempotencyKey:
      context.idempotencyKey ??
      sample.idempotencyKey ??
      deriveIdempotencyKey({
        tenantId: context.tenantId,
        tankId: tank.id,
        deviceId: sample.deviceId,
        observedAt: sample.observedAt,
      }),
  };

  return {
    ...reading,
    freshness: computeFreshness(reading, new Date(receivedAt), {
      staleAfterMinutes: tank.thresholds.staleAfterMinutes,
      delayedAfterMinutes: context.delayedAfterMinutes ?? DEFAULT_DELAYED_AFTER_MINUTES,
    }),
  };
}

/**
 * Volumes are stored with three decimals, matching the `numeric(14,3)` column.
 * This is the only rounding applied to a volume in the domain.
 */
export function roundLitres3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Two decimal rounding, retained for percentages and diagnostic metrics. */
export function roundLitres(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
