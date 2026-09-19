import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, mapResult, ok, unwrapOr, type Result } from '../src/types/result.js';
import {
  isIdentifier,
  newId,
  toAlarmId,
  toDeviceId,
  toReadingId,
  toSiteId,
  toTankId,
  toTenantId,
} from '../src/types/ids.js';
import { InvalidIdentifierError } from '../src/errors.js';
import { fixedClock, manualClock, systemClock, toIsoString } from '../src/ports/clock.js';
import { assertCapacityWithinGeometry, fillPercent, isTankActive } from '../src/domain/tank.js';
import { tankCapacityLitres, type TankGeometry } from '../src/domain/geometry.js';
import { makeTank } from './factories.js';

describe('result helpers', () => {
  it('marks success and failure', () => {
    const success: Result<number, string> = ok(1);
    const failure: Result<number, string> = err('bad');
    expect(isOk(success)).toBe(true);
    expect(isErr(success)).toBe(false);
    expect(isErr(failure)).toBe(true);
    expect(isOk(failure)).toBe(false);
  });

  it('maps only the success path', () => {
    expect(mapResult(ok(2), (value) => value * 2)).toEqual({ ok: true, value: 4 });
    expect(mapResult(err('bad') as Result<number, string>, (value: number) => value * 2)).toEqual({
      ok: false,
      error: 'bad',
    });
  });

  it('unwraps with a fallback', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err('bad') as Result<number, string>, 0)).toBe(0);
  });
});

describe('identifier branding', () => {
  it('accepts lowercase identifiers with hyphens', () => {
    expect(toTenantId('tenant-a')).toBe('tenant-a');
    expect(toSiteId('site-1')).toBe('site-1');
    expect(toTankId('tank-1')).toBe('tank-1');
    expect(toDeviceId('probe-1')).toBe('probe-1');
    expect(toReadingId('rdg-1')).toBe('rdg-1');
    expect(toAlarmId('alm-1')).toBe('alm-1');
  });

  it('rejects empty, uppercase, short and oversized identifiers', () => {
    for (const value of ['', 'A', 'AB', 'Upper-Case', 'with space', 'x'.repeat(65), 'trailing-']) {
      expect(() => toTenantId(value)).toThrow(InvalidIdentifierError);
    }
  });

  it('exposes a reusable predicate', () => {
    expect(isIdentifier('tank-1')).toBe(true);
    expect(isIdentifier('Tank 1')).toBe(false);
  });

  it('generates unique prefixed identifiers that pass validation', () => {
    const first = newId('tank');
    const second = newId('tank');
    expect(first).not.toBe(second);
    expect(isIdentifier(first)).toBe(true);
    expect(first.startsWith('tank-')).toBe(true);
  });
});

describe('clock ports', () => {
  it('returns the current time from the system clock', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before - 1000);
  });

  it('freezes time and does not leak its internal date', () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z');
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('advances a manual clock', () => {
    const clock = manualClock('2026-01-01T00:00:00.000Z');
    clock.advanceMilliseconds(61_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:01.000Z');
    clock.set('2026-02-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('formats timestamps as ISO 8601 UTC', () => {
    expect(toIsoString(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('tank helpers', () => {
  it('computes fill percentage against usable capacity', () => {
    const tank = makeTank({ capacityLitres: 10_000 });
    expect(fillPercent(tank, 2500)).toBe(25);
  });

  it('guards against a zero capacity tank', () => {
    expect(fillPercent(makeTank({ capacityLitres: 0 }), 100)).toBe(0);
    expect(isTankActive(makeTank({ capacityLitres: 0 }))).toBe(false);
  });

  it('treats decommissioned tanks as inactive', () => {
    expect(isTankActive(makeTank({ status: 'decommissioned' }))).toBe(false);
    expect(isTankActive(makeTank({ status: 'active' }))).toBe(true);
  });

  it('rejects a capacity larger than the geometry can hold', () => {
    const geometry: TankGeometry = { kind: 'vertical-cylinder', diameterMm: 1000, heightMm: 1000 };
    // A 1000 mm by 1000 mm cylinder holds about 785 litres.
    expect(() => assertCapacityWithinGeometry(700, geometry)).not.toThrow();
    expect(() => assertCapacityWithinGeometry(100_000, geometry)).toThrow(RangeError);
  });

  it('accepts a capacity within rounding tolerance of the geometry', () => {
    const geometry: TankGeometry = { kind: 'vertical-cylinder', diameterMm: 1000, heightMm: 1000 };
    const exact = tankCapacityLitres(geometry);
    expect(() => assertCapacityWithinGeometry(exact + 0.4, geometry)).not.toThrow();
  });
});
