import { describe, expect, it } from 'vitest';
import { tankCapacityLitres } from '@fueltrack/core';
import { cylinderCapacityLitres, suggestedCapacityLitres } from '../src/lib/geometry.js';

describe('cylinder capacity', () => {
  it('matches the domain formula for both cylinder kinds', () => {
    const cases = [
      { kind: 'vertical-cylinder' as const, diameterMm: 2500, spanMm: 4000 },
      { kind: 'horizontal-cylinder' as const, diameterMm: 2000, spanMm: 6000 },
      { kind: 'vertical-cylinder' as const, diameterMm: 1, spanMm: 1 },
    ];
    for (const sample of cases) {
      const domain =
        sample.kind === 'vertical-cylinder'
          ? tankCapacityLitres({
              kind: sample.kind,
              diameterMm: sample.diameterMm,
              heightMm: sample.spanMm,
            })
          : tankCapacityLitres({
              kind: sample.kind,
              diameterMm: sample.diameterMm,
              lengthMm: sample.spanMm,
            });
      expect(cylinderCapacityLitres(sample.kind, sample.diameterMm, sample.spanMm)).toBe(domain);
    }
  });

  it('returns zero for non-positive dimensions', () => {
    expect(cylinderCapacityLitres('horizontal-cylinder', 0, 1000)).toBe(0);
    expect(cylinderCapacityLitres('vertical-cylinder', 1000, -1)).toBe(0);
    expect(cylinderCapacityLitres('horizontal-cylinder', Number.NaN, 1000)).toBe(0);
  });

  it('suggests a capacity that does not exceed the geometry', () => {
    const suggested = suggestedCapacityLitres('horizontal-cylinder', 2000, 6000);
    const geometric = cylinderCapacityLitres('horizontal-cylinder', 2000, 6000);
    expect(suggested).toBeGreaterThan(0);
    expect(suggested).toBeLessThanOrEqual(geometric);
    expect(suggested).toBe(Math.floor(geometric * 1000) / 1000);
    expect(suggestedCapacityLitres('vertical-cylinder', 0, 10)).toBe(0);
  });
});
