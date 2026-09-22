import {
  DEFAULT_EXPLANATIONS_FOR_DECREASE,
  DEFAULT_EXPLANATIONS_FOR_DELIVERY,
  scoreConfidence,
  type FuelEventEvidence,
  type FuelEventType,
  type FuelEvent,
} from '../domain/event.js';
import { litresToMl, mlToLitres, percentOf, type Millilitres } from '../domain/quantity.js';
import { netVolumeMl, type TankReading } from '../domain/reading.js';
import { usableCapacityMl, type Tank } from '../domain/tank.js';

/**
 * Candidate event detection (TRD section 6).
 *
 * Rules are deliberately rule based and explainable rather than statistical:
 * the platform has too little history to justify a model, and an operator must
 * be able to reproduce every decision from the evidence.
 *
 * The rules detect *candidates*. They never conclude that fuel was lost,
 * stolen, or that a delivery definitely happened. See docs/event-rules.md.
 */
export interface EventDetectionInput {
  readonly tank: Tank;
  /** Readings for the tank, ascending by `recordedAt`. */
  readonly readings: ReadonlyArray<TankReading>;
  /** Existing events used to suppress duplicates of the same observation. */
  readonly existingEvents?: ReadonlyArray<FuelEvent>;
}

export interface FuelEventDraft {
  readonly tankId: Tank['id'];
  readonly type: FuelEventType;
  readonly confidence: number;
  readonly volumeChangeMl: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly evidence: FuelEventEvidence;
}

/**
 * A window shorter than this cannot support a rate calculation: extrapolating
 * a rate from two readings a few seconds apart is arithmetic, not evidence.
 */
export const MIN_DECREASE_WINDOW_MINUTES = 2;

export function detectTankEvents(input: EventDetectionInput): ReadonlyArray<FuelEventDraft> {
  const usable = input.readings.filter((reading) => reading.quality !== 'invalid');
  if (usable.length < 2) {
    return [];
  }

  const drafts: FuelEventDraft[] = [];
  const delivery = detectDeliveryCandidate(input.tank, usable, input.existingEvents ?? []);
  if (delivery !== null) {
    drafts.push(delivery);
  }
  const decrease = detectDecreaseCandidate(input.tank, usable, input.existingEvents ?? []);
  if (decrease !== null) {
    drafts.push(decrease);
  }
  return drafts;
}

/**
 * Candidate delivery: a sustained rise, at least `deliveryLitres`, completed
 * within `deliveryWindowMinutes` and holding at the latest reading.
 */
export function detectDeliveryCandidate(
  tank: Tank,
  usable: ReadonlyArray<TankReading>,
  existingEvents: ReadonlyArray<FuelEvent>,
): FuelEventDraft | null {
  const latest = usable[usable.length - 1];
  if (latest === undefined) {
    return null;
  }
  const windowStartMs =
    Date.parse(latest.recordedAt) - tank.thresholds.deliveryWindowMinutes * 60_000;

  const window = usable.filter((reading) => {
    const at = Date.parse(reading.recordedAt);
    return !Number.isNaN(at) && at >= windowStartMs && at <= Date.parse(latest.recordedAt);
  });
  if (window.length < 2) {
    return null;
  }

  const before = window.reduce((lowest, reading) =>
    netVolumeMl(reading) < netVolumeMl(lowest) ? reading : lowest,
  );
  const riseMl = netVolumeMl(latest) - netVolumeMl(before);
  const thresholdMl = litresToMl(tank.thresholds.deliveryLitres);
  if (riseMl < thresholdMl) {
    return null;
  }
  // A rise that was not sustained to the end of the window is a swing, not a
  // delivery. The latest reading must be the highest of the window.
  const highest = window.reduce((top, reading) =>
    netVolumeMl(reading) > netVolumeMl(top) ? reading : top,
  );
  if (highest.id !== latest.id) {
    return null;
  }
  if (isDuplicate('candidate_delivery', latest.id, existingEvents)) {
    return null;
  }

  const windowMinutes = minutesBetween(before, latest);
  const suspect = window.filter((reading) => reading.quality !== 'ok');
  const capMl = usableCapacityMl(tank);
  const risePercent = capMl > 0 ? percentOf(riseMl, capMl) : 0;

  return {
    tankId: tank.id,
    type: 'candidate_delivery',
    confidence: scoreConfidence({
      observedMl: riseMl,
      thresholdMl,
      suspectReadings: suspect.length,
    }),
    volumeChangeMl: riseMl,
    windowStart: before.recordedAt,
    windowEnd: latest.recordedAt,
    evidence: {
      windowStart: before.recordedAt,
      windowEnd: latest.recordedAt,
      windowMinutes: round2(windowMinutes ?? 0),
      volumeBeforeMl: netVolumeMl(before),
      volumeAfterMl: netVolumeMl(latest),
      volumeChangeMl: riseMl,
      readingIds: window.map((reading) => reading.id),
      firstReadingId: before.id,
      lastReadingId: latest.id,
      thresholdLitresPerHour: null,
      thresholdLitres: tank.thresholds.deliveryLitres,
      rule: `Rise of at least ${tank.thresholds.deliveryLitres} L sustained within ${tank.thresholds.deliveryWindowMinutes} minutes and holding at the latest reading (${risePercent.toFixed(1)}% of usable capacity)`,
      suspectReadingIds: suspect.map((reading) => reading.id),
      dataQuality: suspect.length === 0 ? 'ok' : 'suspect',
      possibleExplanations: DEFAULT_EXPLANATIONS_FOR_DELIVERY,
      investigationRequired: true,
    },
  };
}

/**
 * Candidate unexplained decrease: a sustained loss whose rate exceeds the
 * configured litres per hour. The word "unexplained" is precise: it means the
 * platform holds no delivery, transfer or dispenser record that accounts for
 * the movement, which is all the platform can know before a human looks.
 */
export function detectDecreaseCandidate(
  tank: Tank,
  usable: ReadonlyArray<TankReading>,
  existingEvents: ReadonlyArray<FuelEvent>,
): FuelEventDraft | null {
  const latest = usable[usable.length - 1];
  const previous = usable[usable.length - 2];
  if (latest === undefined || previous === undefined) {
    return null;
  }

  const minutes = minutesBetween(previous, latest);
  if (minutes === null || minutes < MIN_DECREASE_WINDOW_MINUTES) {
    return null;
  }

  const lostMl = netVolumeMl(previous) - netVolumeMl(latest);
  if (lostMl <= 0) {
    return null;
  }

  const thresholdMlPerHour = litresToMl(tank.thresholds.rapidDropLitresPerHour);
  const observedMlPerHour = (lostMl / minutes) * 60;
  if (observedMlPerHour < thresholdMlPerHour) {
    return null;
  }
  if (isDuplicate('candidate_unexplained_decrease', latest.id, existingEvents)) {
    return null;
  }

  const thresholdForWindowMl = (thresholdMlPerHour * minutes) / 60;
  const suspect = [previous, latest].filter((reading) => reading.quality !== 'ok');

  return {
    tankId: tank.id,
    type: 'candidate_unexplained_decrease',
    confidence: scoreConfidence({
      observedMl: lostMl,
      thresholdMl: thresholdForWindowMl,
      suspectReadings: suspect.length,
    }),
    volumeChangeMl: -lostMl,
    windowStart: previous.recordedAt,
    windowEnd: latest.recordedAt,
    evidence: {
      windowStart: previous.recordedAt,
      windowEnd: latest.recordedAt,
      windowMinutes: round2(minutes),
      volumeBeforeMl: netVolumeMl(previous),
      volumeAfterMl: netVolumeMl(latest),
      volumeChangeMl: -lostMl,
      readingIds: [previous.id, latest.id],
      firstReadingId: previous.id,
      lastReadingId: latest.id,
      thresholdLitresPerHour: tank.thresholds.rapidDropLitresPerHour,
      thresholdLitres: mlToLitres(Math.round(thresholdForWindowMl)),
      rule: `Loss rate ${mlToLitres(Math.round(observedMlPerHour)).toFixed(0)} L/h exceeds the configured ${tank.thresholds.rapidDropLitresPerHour} L/h for a decrease of ${mlToLitres(lostMl).toFixed(1)} L over ${minutes.toFixed(1)} minutes`,
      suspectReadingIds: suspect.map((reading) => reading.id),
      dataQuality: suspect.length === 0 ? 'ok' : 'suspect',
      possibleExplanations: DEFAULT_EXPLANATIONS_FOR_DECREASE,
      investigationRequired: true,
    },
  };
}

/**
 * Duplicate suppression. An event that already covers this observation must not
 * be raised again: repeated alerts for one movement train operators to ignore
 * alerts, which is worse than a missing alert.
 */
function isDuplicate(
  type: FuelEventType,
  latestReadingId: string,
  existingEvents: ReadonlyArray<FuelEvent>,
): boolean {
  return existingEvents.some(
    (event) =>
      event.type === type &&
      event.status !== 'rejected' &&
      event.evidence.readingIds.includes(latestReadingId),
  );
}

function minutesBetween(earlier: TankReading, later: TankReading): number | null {
  const start = Date.parse(earlier.recordedAt);
  const end = Date.parse(later.recordedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return (end - start) / 60_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Free capacity after an event, exposed for the confirm dialog in the UI. */
export function headroomAfterEventMl(tank: Tank, volumeAfterMl: Millilitres): Millilitres {
  return Math.max(0, usableCapacityMl(tank) - volumeAfterMl);
}
