import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatCount,
  formatDateTime,
  formatLitres,
  formatLitresPrecise,
  formatMillilitresAsLitres,
  formatNumber,
  formatPercent,
  formatWhen,
  litresFromMl,
  titleCase,
  wallTimeToUtcIso,
} from '../src/lib/format.js';

describe('quantity formatting', () => {
  it('labels a missing quantity instead of inventing zero', () => {
    expect(formatLitres(null)).toBe('No reading');
    expect(formatLitres(undefined)).toBe('No reading');
    expect(formatLitres(Number.NaN)).toBe('No reading');
    expect(formatLitresPrecise(null)).toBe('No reading');
    expect(formatMillilitresAsLitres(undefined)).toBe('No reading');
    expect(formatPercent(null)).toBe('No reading');
    expect(formatNumber(null)).toBe('-');
    expect(formatCount(null)).toBe('-');
  });

  it('formats litres, millilitres and counts', () => {
    expect(formatLitres(19000)).toBe('19,000 L');
    expect(formatLitresPrecise(12.34)).toBe('12.3 L');
    expect(litresFromMl(1_500_000)).toBe('1,500 L');
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatNumber(12.345, 2)).toBe('12.35');
    expect(formatCount(3)).toBe('3');
  });
});

describe('time formatting', () => {
  it('formats a timestamp and rejects a bad one', () => {
    expect(formatDateTime(null)).toBe('Not recorded');
    expect(formatDateTime('')).toBe('Not recorded');
    expect(formatDateTime('not-a-date')).toBe('Invalid time');
    expect(formatWhen('2026-01-15T08:30:00.000Z', 'UTC')).toContain('2026');
    expect(formatDateTime('2026-01-15T08:30:00.000Z', 'Not/A_Zone')).toContain('2026');
  });

  it('describes age without treating the future as just now', () => {
    const now = Date.parse('2026-01-15T12:00:00.000Z');
    expect(formatAge(null, now)).toBe('No reading');
    expect(formatAge('nope', now)).toBe('Unknown age');
    expect(formatAge('2026-01-15T12:10:00.000Z', now)).toBe('Ahead of this clock');
    expect(formatAge('2026-01-15T11:59:40.000Z', now)).toBe('Just now');
    expect(formatAge('2026-01-15T11:30:00.000Z', now)).toBe('30 min ago');
    expect(formatAge('2026-01-15T08:00:00.000Z', now)).toBe('4 h ago');
    expect(formatAge('2026-01-10T12:00:00.000Z', now)).toBe('5 d ago');
  });

  it('converts an East African wall time to a UTC instant', () => {
    expect(wallTimeToUtcIso('2026-03-02T09:15', 'Africa/Dar_es_Salaam')).toBe(
      '2026-03-02T06:15:00.000Z',
    );
    expect(wallTimeToUtcIso('2026-03-02T09:15:30', 'Africa/Dar_es_Salaam')).toBe(
      '2026-03-02T06:15:30.000Z',
    );
    expect(wallTimeToUtcIso('tomorrow', 'Africa/Dar_es_Salaam')).toBeNull();
    expect(wallTimeToUtcIso('2026-13-02T09:15', 'UTC')).toBeNull();
    expect(wallTimeToUtcIso('2026-03-02T25:15', 'UTC')).toBeNull();
  });
});

describe('title case', () => {
  it('splits snake and kebab case', () => {
    expect(titleCase('candidate_unexplained-decrease')).toBe('Candidate Unexplained Decrease');
    expect(titleCase('')).toBe('');
  });
});
