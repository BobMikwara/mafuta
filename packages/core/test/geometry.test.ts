import { describe, expect, it } from 'vitest';
import {
  levelForVolumeLitres,
  maxLevelMm,
  tankCapacityLitres,
  volumeAtLevelLitres,
} from '../src/domain/geometry.js';
import { DEFAULT_TEST_GEOMETRY } from './factories.js';

describe('tank geometry', () => {
  it('computes vertical cylinder capacity and scales linearly with level', () => {
    const geometry = { kind: 'vertical-cylinder', diameterMm: 2000, heightMm: 3000 } as const;
    expect(tankCapacityLitres(geometry)).toBeCloseTo(9424.78, 1);
    expect(volumeAtLevelLitres(geometry, 1500)).toBeCloseTo(4712.39, 1);
    expect(maxLevelMm(geometry)).toBe(3000);
  });

  it('computes horizontal cylinder partial fill with the circular segment area', () => {
    const geometry = { kind: 'horizontal-cylinder', diameterMm: 2000, lengthMm: 5000 } as const;
    expect(tankCapacityLitres(geometry)).toBeCloseTo(15707.96, 1);
    // A half full horizontal cylinder holds half its capacity.
    expect(volumeAtLevelLitres(geometry, 1000)).toBeCloseTo(7853.98, 1);
    // A quarter full horizontal cylinder holds materially less than a quarter.
    expect(volumeAtLevelLitres(geometry, 500)).toBeLessThan(15707.96 * 0.25);
    expect(volumeAtLevelLitres(geometry, 500)).toBeGreaterThan(0);
  });

  it('interpolates strapping tables and clamps outside the table', () => {
    const geometry = {
      kind: 'strapping-table',
      points: [
        { levelMm: 0, volumeLitres: 0 },
        { levelMm: 1000, volumeLitres: 5000 },
        { levelMm: 2000, volumeLitres: 10_000 },
      ],
    } as const;

    expect(volumeAtLevelLitres(geometry, 500)).toBeCloseTo(2500, 6);
    expect(volumeAtLevelLitres(geometry, 1500)).toBeCloseTo(7500, 6);
    expect(volumeAtLevelLitres(geometry, 5000)).toBeCloseTo(10_000, 6);
    expect(tankCapacityLitres(geometry)).toBe(10_000);
  });

  it('treats negative and non finite levels as no product at all', () => {
    // Over reporting inventory is worse than under reporting it, so an
    // unmeasurable level never resolves to a full tank.
    expect(volumeAtLevelLitres(DEFAULT_TEST_GEOMETRY, -10)).toBe(0);
    expect(volumeAtLevelLitres(DEFAULT_TEST_GEOMETRY, Number.NaN)).toBe(0);
    expect(volumeAtLevelLitres(DEFAULT_TEST_GEOMETRY, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('clamps a level above the geometry to full capacity', () => {
    expect(volumeAtLevelLitres(DEFAULT_TEST_GEOMETRY, 10_000)).toBeCloseTo(
      tankCapacityLitres(DEFAULT_TEST_GEOMETRY),
      6,
    );
  });

  it('inverts volume back to level for every geometry shape', () => {
    const geometries = [
      { kind: 'vertical-cylinder', diameterMm: 2500, heightMm: 4000 },
      { kind: 'horizontal-cylinder', diameterMm: 2500, lengthMm: 6000 },
      {
        kind: 'strapping-table',
        points: [
          { levelMm: 0, volumeLitres: 0 },
          { levelMm: 1000, volumeLitres: 4800 },
          { levelMm: 2500, volumeLitres: 11_500 },
        ],
      },
    ] as const;

    for (const geometry of geometries) {
      const capacity = tankCapacityLitres(geometry);
      for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const target = capacity * fraction;
        const level = levelForVolumeLitres(geometry, target);
        expect(volumeAtLevelLitres(geometry, level)).toBeCloseTo(target, 1);
      }
    }
  });

  it('inverts to the maximum level when the volume exceeds capacity', () => {
    const geometry = { kind: 'vertical-cylinder', diameterMm: 1000, heightMm: 1000 } as const;
    expect(levelForVolumeLitres(geometry, 1e9)).toBeCloseTo(1000, 6);
    expect(levelForVolumeLitres(geometry, 0)).toBe(0);
  });
});
