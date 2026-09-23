import { describe, expect, it } from 'vitest';
import {
  classifyProbeSample,
  normalizeProbeSample,
  round2,
  roundLitres,
  roundLitres3,
  type ProbeSample,
} from '../src/domain/normalize.js';
import { maxLevelMm } from '../src/domain/geometry.js';
import type { Tank } from '../src/domain/tank.js';
import { makeTank, readingId, TENANT_A } from './factories.js';

/**
 * Probe normalization is where a physical observation becomes an inventory
 * reading: impossible values must be labelled `invalid`, doubtful ones kept as
 * `suspect`, submission identity must survive, and every number passes through
 * the documented roundings. These rules gate what can ever enter the ledger.
 */

function sample(overrides: Partial<ProbeSample> = {}): ProbeSample {
  return {
    tankId: makeTank().id,
    observedAt: '2026-01-01T10:00:00.000Z',
    levelMm: 2000,
    waterLevelMm: 10,
    temperatureC: 21,
    deviceId: null,
    source: 'device',
    ...overrides,
  };
}

const tank: Tank = makeTank();

describe('classifyProbeSample', () => {
  it('accepts a plausible sample', () => {
    expect(classifyProbeSample(tank, sample())).toEqual({ quality: 'ok', reason: null });
  });

  it('rejects non-finite and negative levels', () => {
    expect(classifyProbeSample(tank, sample({ levelMm: Number.NaN })).quality).toBe('invalid');
    expect(classifyProbeSample(tank, sample({ levelMm: -1 })).reason).toBe('negative level');
    expect(classifyProbeSample(tank, sample({ waterLevelMm: -5 })).quality).toBe('invalid');
  });

  it('rejects water above the product level', () => {
    const verdict = classifyProbeSample(tank, sample({ levelMm: 100, waterLevelMm: 150 }));
    expect(verdict.reason).toBe('water level above product level');
  });

  it('rejects levels beyond the measurable geometry', () => {
    const verdict = classifyProbeSample(tank, sample({ levelMm: maxLevelMm(tank.geometry) + 1 }));
    expect(verdict.quality).toBe('invalid');
    expect(verdict.reason).toContain('exceeds the maximum');
  });

  it('marks out-of-range and non-finite temperatures as suspect', () => {
    expect(classifyProbeSample(tank, sample({ temperatureC: null })).quality).toBe('ok');
    expect(classifyProbeSample(tank, sample({ temperatureC: 121 })).quality).toBe('suspect');
    expect(classifyProbeSample(tank, sample({ temperatureC: -61 })).quality).toBe('suspect');
    expect(
      classifyProbeSample(tank, sample({ temperatureC: Number.POSITIVE_INFINITY })).quality,
    ).toBe('suspect');
  });

  it('marks weak signal quality as suspect below the 40% threshold only', () => {
    expect(classifyProbeSample(tank, sample({ signalQualityPercent: 30 })).reason).toContain(
      'signal quality',
    );
    expect(classifyProbeSample(tank, sample({ signalQualityPercent: 40 })).quality).toBe('ok');
    expect(classifyProbeSample(tank, sample({ signalQualityPercent: 55 })).quality).toBe('ok');
  });
});

describe('normalizeProbeSample', () => {
  const context = {
    tenantId: TENANT_A,
    receivedAt: '2026-01-01T10:05:00.000Z',
  };

  it('derives a stable idempotency key when none is submitted', () => {
    const first = normalizeProbeSample(tank, sample(), context);
    const second = normalizeProbeSample(tank, sample(), context);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).not.toBe('');
    expect(first.provenance).toBe('measured');
    expect(first.sourceProtocol).toBe('http');
  });

  it('prefers the caller key, then the sample key, over the derived key', () => {
    const fromContext = normalizeProbeSample(tank, sample({ idempotencyKey: 'sample-key' }), {
      ...context,
      idempotencyKey: 'context-key',
    });
    expect(fromContext.idempotencyKey).toBe('context-key');

    const fromSample = normalizeProbeSample(
      tank,
      sample({ idempotencyKey: 'sample-key' }),
      context,
    );
    expect(fromSample.idempotencyKey).toBe('sample-key');
  });

  it('keeps the supplied reading id and raw message reference', () => {
    const reading = normalizeProbeSample(tank, sample(), {
      ...context,
      readingId: readingId('rdg-fixed'),
      rawMessageId: 'raw-9',
    });
    expect(reading.id).toBe('rdg-fixed');
    expect(reading.rawMessageId).toBe('raw-9');
  });

  it('clamps impossible levels to zero volume but keeps the verdict', () => {
    const reading = normalizeProbeSample(
      tank,
      sample({ levelMm: Number.NaN, waterLevelMm: 50 }),
      context,
    );
    expect(reading.quality).toBe('invalid');
    expect(reading.levelMm).toBe(0);
    expect(reading.waterLevelMm).toBe(0);
    expect(reading.netVolumeLitres).toBe(0);
    expect(reading.grossVolumeLitres).toBe(0);
  });

  it('computes freshness at read time with the delayed policy window', () => {
    const late = {
      ...context,
      receivedAt: '2026-01-01T10:30:00.000Z',
    };
    expect(normalizeProbeSample(tank, sample(), late).freshness).toBe('delayed');
    expect(
      normalizeProbeSample(tank, sample(), { ...late, delayedAfterMinutes: 60 }).freshness,
    ).toBe('fresh');

    const veryLate = { ...context, receivedAt: '2026-01-01T13:00:00.000Z' };
    expect(normalizeProbeSample(tank, sample(), veryLate).freshness).toBe('stale');
  });

  it('maps a manual source to its manual provenance', () => {
    const reading = normalizeProbeSample(tank, sample({ source: 'manual' }), context);
    expect(reading.provenance).toBe('manual');
    expect(reading.sourceProtocol).toBe('manual');
  });
});

describe('documented volume roundings', () => {
  it('rounds volumes to three decimals and diagnostics to two', () => {
    expect(roundLitres3(1.23456)).toBe(1.235);
    expect(roundLitres3(0.0004)).toBe(0);
    expect(roundLitres(1.234)).toBe(1.23);
    expect(round2(-1.239)).toBe(-1.24);
  });
});
