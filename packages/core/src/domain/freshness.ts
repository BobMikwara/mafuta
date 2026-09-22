import type { ReadingFreshness, TankReading } from './reading.js';

/**
 * Freshness is a property of *when it is read*, not of the row: a reading that
 * was fresh when written is stale five minutes later. Nothing in the platform
 * may present an old measurement as live (rules.md), so every read path
 * recomputes freshness instead of trusting the stored value.
 */
export interface FreshnessPolicy {
  /** Age after which a reading must be presented as stale. */
  readonly staleAfterMinutes: number;
  /** Transit delay after which a reading is presented as delayed. */
  readonly delayedAfterMinutes: number;
}

/** Default transit delay. Documented in docs/data-freshness.md. */
export const DEFAULT_DELAYED_AFTER_MINUTES = 15;

export function computeFreshness(
  reading: Pick<TankReading, 'recordedAt' | 'receivedAt'>,
  now: Date,
  policy: FreshnessPolicy,
): ReadingFreshness {
  const recorded = Date.parse(reading.recordedAt);
  const received = Date.parse(reading.receivedAt);
  if (Number.isNaN(recorded)) {
    return 'stale';
  }
  const ageMinutes = (now.getTime() - recorded) / 60_000;
  if (ageMinutes > policy.staleAfterMinutes) {
    return 'stale';
  }
  if (!Number.isNaN(received)) {
    const transitMinutes = (received - recorded) / 60_000;
    if (transitMinutes > policy.delayedAfterMinutes) {
      return 'delayed';
    }
  }
  return 'fresh';
}

/**
 * Applies a freshness policy to a reading without mutating it, so a stored row
 * keeps the freshness it had when written and every response carries the value
 * computed now.
 */
export function withFreshness(
  reading: TankReading,
  now: Date,
  policy: FreshnessPolicy,
): TankReading {
  return { ...reading, freshness: computeFreshness(reading, now, policy) };
}

export function isFresh(freshness: ReadingFreshness): boolean {
  return freshness === 'fresh';
}

/** Minutes since the reading was recorded, or null when unparseable. */
export function ageMinutes(reading: Pick<TankReading, 'recordedAt'>, now: Date): number | null {
  const recorded = Date.parse(reading.recordedAt);
  if (Number.isNaN(recorded)) {
    return null;
  }
  return (now.getTime() - recorded) / 60_000;
}
