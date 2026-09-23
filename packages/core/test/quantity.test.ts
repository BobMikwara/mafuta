import { describe, expect, it } from 'vitest';
import {
  formatLitres,
  isMillilitres,
  litresPerHourToMlPerHour,
  litresString,
  litresToMl,
  mlToLitres,
  parseLitresToMl,
  percentOf,
  roundLevelMm,
  sumMl,
} from '../src/domain/quantity.js';

/**
 * The exact-quantity rules from TRD section 4: integer millilitres inside the
 * domain, a single documented rounding at each boundary, and loud failures
 * instead of silent NaN arithmetic. Every branch of the conversion helpers is
 * pinned here because inventory totals inherit their behaviour.
 */

describe('litresToMl', () => {
  it('rounds half away from zero on both sides of the sign', () => {
    expect(litresToMl(1.2345)).toBe(1235);
    expect(litresToMl(-1.2345)).toBe(-1235);
    expect(litresToMl(2)).toBe(2000);
  });

  it('rejects non-finite input', () => {
    expect(() => litresToMl(Number.NaN)).toThrow(RangeError);
    expect(() => litresToMl(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatLitres', () => {
  it('renders three decimal places and pads short fractions', () => {
    expect(formatLitres(1_234_567)).toBe('1234.567');
    expect(formatLitres(5)).toBe('0.005');
    expect(litresString(1_500)).toBe('1.500');
  });

  it('keeps the sign of negative balances', () => {
    expect(formatLitres(-1_234_567)).toBe('-1234.567');
    expect(formatLitres(-500)).toBe('-0.500');
  });

  it('clamps the requested decimal count to 0 through 3', () => {
    expect(formatLitres(1_234_567, 0)).toBe('1234');
    expect(formatLitres(1_234_567, 2)).toBe('1234.56');
    expect(formatLitres(1_234_567, 9)).toBe('1234.567');
    expect(formatLitres(-1_234_567, -2)).toBe('-1234');
    expect(formatLitres(1_234_567, 1.9)).toBe('1234.5');
  });
});

describe('parseLitresToMl', () => {
  it('parses decimal strings and rounds the fourth decimal', () => {
    expect(parseLitresToMl('1234.5678')).toBe(1_234_568);
    expect(parseLitresToMl('1234.5674')).toBe(1_234_567);
    expect(parseLitresToMl('-12.5')).toBe(-12_500);
    expect(parseLitresToMl(' 42 ')).toBe(42_000);
  });

  it('accepts missing whole or fraction parts', () => {
    expect(parseLitresToMl('.5')).toBe(500);
    expect(parseLitresToMl('7.')).toBe(7_000);
  });

  it('accepts numbers and objects that render as decimals', () => {
    expect(parseLitresToMl(1.5)).toBe(1_500);
    expect(parseLitresToMl({ toString: () => '2.25' })).toBe(2_250);
  });

  it('rejects empty, non-numeric and out-of-range values', () => {
    expect(() => parseLitresToMl('')).toThrow(RangeError);
    expect(() => parseLitresToMl('   ')).toThrow(RangeError);
    expect(() => parseLitresToMl('abc')).toThrow(RangeError);
    expect(() => parseLitresToMl('1e3')).toThrow(RangeError);
    expect(() => parseLitresToMl('.')).toThrow(RangeError);
    expect(() => parseLitresToMl('9007199254740993')).toThrow(RangeError);
  });
});

describe('totals and percentages', () => {
  it('sums any number of millilitre amounts', () => {
    expect(sumMl([])).toBe(0);
    expect(sumMl([1_000, 2_000, -500])).toBe(2_500);
  });

  it('reports percentages and treats empty totals as zero', () => {
    expect(percentOf(50_000, 100_000)).toBe(50);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(5, -1)).toBe(0);
  });

  it('converts threshold rates and validates millilitre values', () => {
    expect(litresPerHourToMlPerHour(1.5)).toBe(1_500);
    expect(isMillilitres(5)).toBe(true);
    expect(isMillilitres(5.5)).toBe(false);
    expect(isMillilitres('5')).toBe(false);
    expect(isMillilitres(Number.NaN)).toBe(false);
  });
});

describe('roundLevelMm', () => {
  it('rounds to 0.01 mm and maps non-finite input to zero', () => {
    expect(roundLevelMm(1.234)).toBe(1.23);
    expect(roundLevelMm(2.345)).toBe(2.35);
    expect(roundLevelMm(Number.POSITIVE_INFINITY)).toBe(0);
    expect(roundLevelMm(Number.NaN)).toBe(0);
  });

  it('converts millilitres back to litres for display only', () => {
    expect(mlToLitres(1_234)).toBe(1.234);
  });
});
