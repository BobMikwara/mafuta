import type { FuelEventId, ReadingId, TankId, TenantId } from '../types/ids.js';

/**
 * Candidate fuel events.
 *
 * An event is an inferred observation that requires a human decision: a
 * suspected delivery, or a decrease that the platform cannot explain from the
 * data it holds. Events are never evidence of wrongdoing on their own.
 *
 * rules.md forbids classifying unexplained movement as theft automatically, so
 * the evidence carries *possible explanations* and an explicit statement that
 * investigation is required, never a conclusion.
 */
export const FUEL_EVENT_TYPES = ['candidate_delivery', 'candidate_unexplained_decrease'] as const;
export type FuelEventType = (typeof FUEL_EVENT_TYPES)[number];

export type FuelEventStatus = 'candidate' | 'confirmed' | 'rejected';

/** Tuple form so the validation layer can build a strict enum schema from it. */
export const FUEL_EVENT_STATUSES = ['candidate', 'confirmed', 'rejected'] as const;

/**
 * Structured evidence, stored as JSON next to the event so a reviewer can see
 * exactly which readings produced it and which rule fired.
 */
export interface FuelEventEvidence {
  /** First and last reading of the window that produced the event, UTC. */
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly windowMinutes: number;
  /** Net volume immediately before and after the window, in millilitres. */
  readonly volumeBeforeMl: number;
  readonly volumeAfterMl: number;
  /** Signed change across the window, in millilitres. */
  readonly volumeChangeMl: number;
  /** Readings that were considered, oldest first. */
  readonly readingIds: ReadonlyArray<string>;
  readonly firstReadingId: ReadingId | null;
  readonly lastReadingId: ReadingId | null;
  /** Threshold that fired, in the unit the operator configured it in. */
  readonly thresholdLitresPerHour: number | null;
  readonly thresholdLitres: number | null;
  /** Human readable rule description, safe to show in the UI and reports. */
  readonly rule: string;
  /** Readings in the window with a quality other than `ok`. */
  readonly suspectReadingIds: ReadonlyArray<string>;
  readonly dataQuality: 'ok' | 'suspect';
  /**
   * Plausible explanations to investigate. Never a conclusion, and never the
   * word theft: a human decides what an unexplained decrease means.
   */
  readonly possibleExplanations: ReadonlyArray<string>;
  readonly investigationRequired: boolean;
}

export interface FuelEvent {
  readonly id: FuelEventId;
  readonly tenantId: TenantId;
  readonly tankId: TankId;
  readonly type: FuelEventType;
  readonly status: FuelEventStatus;
  /** 0 to 1. Explainable confidence, never presented as certainty. */
  readonly confidence: number;
  /** Signed volume change in millilitres that triggered the candidate. */
  readonly volumeChangeMl: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly evidence: FuelEventEvidence;
  readonly notes: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const DEFAULT_EXPLANATIONS_FOR_DECREASE: ReadonlyArray<string> = [
  'Unrecorded withdrawal or transfer',
  'Sale not captured because no dispenser data is integrated yet',
  'Tank or line leak',
  'Probe or calibration error',
  'Reading taken at a different temperature than the previous reading',
];

export const DEFAULT_EXPLANATIONS_FOR_DELIVERY: ReadonlyArray<string> = [
  'Fuel delivery recorded by the supplier',
  'Transfer between tanks',
  'Probe or calibration error on the rise',
];

/**
 * Confidence model. Deliberately simple, deterministic and explainable:
 *
 *   base   = 0.5 + 0.5 * min(1, excessRatio)
 *   excess = (observed change - minimum change) / minimum change
 *
 * so a change that just meets the threshold scores 0.5, one that is twice the
 * threshold scores 0.75, and a much larger one approaches 1. The score is
 * multiplied by 0.8 when any reading in the window has a quality other than
 * `ok`, because a suspect measurement is weaker evidence.
 *
 * The value is stored with the event and shown in the UI as a percentage. It is
 * never presented as a probability that fuel was lost or stolen.
 */
export function scoreConfidence(input: {
  readonly observedMl: number;
  readonly thresholdMl: number;
  readonly suspectReadings: number;
}): number {
  const threshold = Math.max(1, Math.abs(input.thresholdMl));
  const observed = Math.abs(input.observedMl);
  const excessRatio = Math.max(0, Math.min(1, (observed - threshold) / threshold));
  const base = input.observedMl < threshold ? 0 : 0.5 + 0.5 * excessRatio;
  const penalty = input.suspectReadings > 0 ? 0.8 : 1;
  return Math.round(base * penalty * 1000) / 1000;
}

export function isFuelEventType(value: string): value is FuelEventType {
  return (FUEL_EVENT_TYPES as ReadonlyArray<string>).includes(value);
}
