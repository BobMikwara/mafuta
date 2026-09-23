import { describe, expect, it } from 'vitest';
import { fixedClock, manualClock, systemClock, toIsoString } from '../src/ports/clock.js';

/**
 * The clock is the platform's only source of time (UTC everywhere), so both of
 * its implementations and the manual test clock's control surface are pinned
 * here: string and Date inputs must behave identically.
 */

describe('systemClock', () => {
  it('returns the wall clock', () => {
    const before = Date.now();
    const at = systemClock.now().getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});

describe('fixedClock', () => {
  it('accepts a Date or an ISO string and never drifts', () => {
    const fromString = fixedClock('2026-03-01T00:00:00.000Z');
    const fromDate = fixedClock(new Date('2026-03-01T00:00:00.000Z'));
    expect(fromString.now().toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(fromDate.now().toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(fromString.now().getTime()).toBe(fromString.now().getTime());
  });
});

describe('manualClock', () => {
  it('starts at its documented default when given nothing', () => {
    expect(manualClock().now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('accepts a Date or an ISO string as its start', () => {
    expect(manualClock('2026-02-01T00:00:00.000Z').now().toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    expect(manualClock(new Date('2026-02-01T00:00:00.000Z')).now().toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('is settable and advanceable with either input form', () => {
    const clock = manualClock();
    clock.set('2026-01-01T01:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T01:00:00.000Z');
    clock.set(new Date('2026-01-01T02:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-01-01T02:00:00.000Z');
    clock.advanceMilliseconds(90_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T02:01:30.000Z');
    expect(toIsoString(clock.now())).toBe('2026-01-01T02:01:30.000Z');
  });
});
