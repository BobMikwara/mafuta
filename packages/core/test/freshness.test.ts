import { describe, expect, it } from 'vitest';
import {
  ageMinutes,
  computeFreshness,
  DEFAULT_DELAYED_AFTER_MINUTES,
  isFresh,
  withFreshness,
} from '../src/domain/freshness.js';
import { makeReading } from './factories.js';

/**
 * Freshness is recomputed on every read path (rules.md: an old measurement is
 * never presented as live). The policy branches - unparseable timestamps,
 * stale age, transit delay - are the contract behind every freshness badge.
 */

const NOW = new Date('2026-01-01T12:00:00.000Z');
const policy = { staleAfterMinutes: 60, delayedAfterMinutes: DEFAULT_DELAYED_AFTER_MINUTES };

describe('computeFreshness', () => {
  it('reports fresh for a recent, promptly received reading', () => {
    const reading = makeReading({
      recordedAt: '2026-01-01T11:55:00.000Z',
      receivedAt: '2026-01-01T11:56:00.000Z',
    });
    expect(computeFreshness(reading, NOW, policy)).toBe('fresh');
  });

  it('reports stale when the reading is older than the policy window', () => {
    const reading = makeReading({
      recordedAt: '2026-01-01T10:00:00.000Z',
      receivedAt: '2026-01-01T10:01:00.000Z',
    });
    expect(computeFreshness(reading, NOW, policy)).toBe('stale');
  });

  it('reports stale for an unparseable recording time', () => {
    const reading = makeReading({
      recordedAt: 'not-a-date',
      receivedAt: '2026-01-01T11:59:00.000Z',
    });
    expect(computeFreshness(reading, NOW, policy)).toBe('stale');
  });

  it('reports delayed when transit exceeds the delay window', () => {
    const reading = makeReading({
      recordedAt: '2026-01-01T11:40:00.000Z',
      receivedAt: '2026-01-01T12:00:00.000Z',
    });
    expect(computeFreshness(reading, NOW, policy)).toBe('delayed');
  });

  it('falls back to fresh when the receive time cannot be parsed', () => {
    const reading = makeReading({
      recordedAt: '2026-01-01T11:55:00.000Z',
      receivedAt: 'not-a-date',
    });
    expect(computeFreshness(reading, NOW, policy)).toBe('fresh');
  });
});

describe('withFreshness', () => {
  it('returns a copy carrying the freshness computed for the read time', () => {
    const stored = makeReading({
      recordedAt: '2026-01-01T09:00:00.000Z',
      receivedAt: '2026-01-01T09:01:00.000Z',
    });
    const presented = withFreshness(stored, NOW, policy);
    expect(presented.freshness).toBe('stale');
    expect(stored).not.toBe(presented);
  });
});

describe('helpers', () => {
  it('knows what fresh means', () => {
    expect(isFresh('fresh')).toBe(true);
    expect(isFresh('stale')).toBe(false);
    expect(isFresh('delayed')).toBe(false);
  });

  it('measures age or returns null for unparseable times', () => {
    expect(ageMinutes({ recordedAt: '2026-01-01T11:30:00.000Z' }, NOW)).toBe(30);
    expect(ageMinutes({ recordedAt: 'junk' }, NOW)).toBeNull();
  });
});
