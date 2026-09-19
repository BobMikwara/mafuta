import { maxLevelMm, volumeAtLevelLitres } from './geometry.js';
import type { Tank } from './tank.js';
import type { TankReading, ReadingQuality, ReadingSource } from './reading.js';
import type { ReadingId, TankId } from '../types/ids.js';
import { newId } from '../types/ids.js';

/**
 * A raw sample as produced by a tank gauge adapter. Adapters must never invent
 * volumes: they report physical observations and this normalizer converts them
 * into domain readings using the tank geometry.
 */
export interface ProbeSample {
  readonly tankId: TankId;
  readonly observedAt: string;
  readonly levelMm: number;
  readonly waterLevelMm: number;
  readonly temperatureC: number | null;
  readonly deviceId: string | null;
  readonly source: ReadingSource;
  /** Optional 0-100 signal quality reported by the probe. */
  readonly signalQualityPercent?: number;
}

export interface NormalizeContext {
  readonly tenantId: TankReading['tenantId'];
  readonly receivedAt: string;
  readonly readingId?: ReadingId;
}

const SIGNAL_QUALITY_SUSPECT_PERCENT = 40;

export function classifyProbeSample(tank: Tank, sample: ProbeSample): ReadingQuality {
  const { levelMm, waterLevelMm, signalQualityPercent } = sample;
  if (!Number.isFinite(levelMm) || !Number.isFinite(waterLevelMm)) {
    return 'invalid';
  }
  if (levelMm < 0 || waterLevelMm < 0) {
    return 'invalid';
  }
  if (waterLevelMm > levelMm) {
    return 'invalid';
  }
  if (temperatureOutOfRange(sample.temperatureC)) {
    return 'suspect';
  }
  if (levelMm > maxLevelMm(tank.geometry)) {
    return 'invalid';
  }
  if (signalQualityPercent !== undefined && signalQualityPercent < SIGNAL_QUALITY_SUSPECT_PERCENT) {
    return 'suspect';
  }
  return 'ok';
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
  const quality = classifyProbeSample(tank, sample);
  const safeLevelMm = Number.isFinite(sample.levelMm) ? Math.max(0, sample.levelMm) : 0;
  const safeWaterLevelMm = Number.isFinite(sample.waterLevelMm)
    ? Math.max(0, Math.min(sample.waterLevelMm, safeLevelMm))
    : 0;

  const grossVolumeLitres = roundLitres(volumeAtLevelLitres(tank.geometry, safeLevelMm));
  const waterVolumeLitres = roundLitres(volumeAtLevelLitres(tank.geometry, safeWaterLevelMm));
  const netVolumeLitres = roundLitres(Math.max(0, grossVolumeLitres - waterVolumeLitres));

  return {
    id: context.readingId ?? (newId('rdg') as ReadingId),
    tenantId: context.tenantId,
    tankId: tank.id,
    recordedAt: sample.observedAt,
    receivedAt: context.receivedAt,
    levelMm: round2(safeLevelMm),
    waterLevelMm: round2(safeWaterLevelMm),
    grossVolumeLitres,
    netVolumeLitres,
    temperatureC: sample.temperatureC,
    source: sample.source,
    quality,
    deviceId: sample.deviceId,
  };
}

export function roundLitres(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
