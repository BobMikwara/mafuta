import {
  DEFAULT_TANK_THRESHOLDS,
  fillPercent,
  type Tank,
  type TankThresholds,
} from '../domain/tank.js';
import type { Alarm, AlarmDraft, AlarmSeverity, AlarmType } from '../domain/alarm.js';
import type { TankReading } from '../domain/reading.js';
import { newId, type AlarmId, type TenantId } from '../types/ids.js';

export interface AlarmEvaluationInput {
  readonly tenantId: TenantId;
  readonly tank: Tank;
  /** Readings for this tank, ascending by `recordedAt`. */
  readonly readings: ReadonlyArray<TankReading>;
  /** Current time used for staleness calculation. */
  readonly now: Date;
  /** Number of consecutive invalid readings that triggers a sensor fault. */
  readonly consecutiveInvalidForFault?: number;
}

export interface AlarmEvaluationResult {
  readonly drafts: ReadonlyArray<AlarmDraft>;
  readonly estimatedNetVolumeLitres: number | null;
  readonly fillPercent: number | null;
}

const DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT = 3;

export function evaluateTankAlarms(input: AlarmEvaluationInput): AlarmEvaluationResult {
  const { tank, readings, now } = input;
  const thresholds: TankThresholds = tank.thresholds ?? DEFAULT_TANK_THRESHOLDS;
  const drafts: AlarmDraft[] = [];

  const usable = readings.filter((reading) => reading.quality !== 'invalid');
  const latest = usable[usable.length - 1];

  if (latest === undefined) {
    return {
      drafts: draftsFromStaleState(input, 'no usable readings'),
      estimatedNetVolumeLitres: null,
      fillPercent: null,
    };
  }

  const percent = fillPercent(tank, latest.netVolumeLitres);

  if (percent <= thresholds.criticalLowPercent) {
    drafts.push(
      draft(
        latest,
        'critical-low-level',
        'critical',
        `Critical low level: ${percent.toFixed(1)}% of capacity`,
        {
          fillPercent: round2(percent),
          netVolumeLitres: latest.netVolumeLitres,
        },
      ),
    );
  } else if (percent <= thresholds.lowPercent) {
    drafts.push(
      draft(latest, 'low-level', 'warning', `Low level: ${percent.toFixed(1)}% of capacity`, {
        fillPercent: round2(percent),
        netVolumeLitres: latest.netVolumeLitres,
      }),
    );
  }

  if (percent >= thresholds.highPercent) {
    drafts.push(
      draft(
        latest,
        'high-level',
        'warning',
        `High level: ${percent.toFixed(1)}% of capacity (overfill risk)`,
        {
          fillPercent: round2(percent),
          netVolumeLitres: latest.netVolumeLitres,
        },
      ),
    );
  }

  if (latest.waterLevelMm >= thresholds.waterAlarmMm) {
    drafts.push(
      draft(
        latest,
        'water-ingress',
        'warning',
        `Water level ${latest.waterLevelMm.toFixed(1)} mm`,
        {
          waterLevelMm: latest.waterLevelMm,
        },
      ),
    );
  }

  const previous = usable[usable.length - 2];
  if (previous !== undefined) {
    const dropRate = dropLitresPerHour(previous, latest);
    if (dropRate !== null && dropRate >= thresholds.rapidDropLitresPerHour) {
      drafts.push(
        draft(
          latest,
          'rapid-drop',
          'critical',
          `Rapid loss of ${dropRate.toFixed(0)} L/h detected (possible leak or theft)`,
          { litresPerHour: round2(dropRate) },
        ),
      );
    }

    const rise = latest.netVolumeLitres - previous.netVolumeLitres;
    const windowMinutes = minutesBetween(previous, latest);
    if (
      rise >= thresholds.deliveryLitres &&
      windowMinutes !== null &&
      windowMinutes <= thresholds.deliveryWindowMinutes
    ) {
      drafts.push(
        draft(latest, 'delivery-detected', 'info', `Delivery of ${rise.toFixed(0)} L detected`, {
          litresAdded: round2(rise),
          windowMinutes: round2(windowMinutes),
        }),
      );
    }
  }

  const faultThreshold = input.consecutiveInvalidForFault ?? DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT;
  const trailing = readings.slice(-faultThreshold);
  if (
    trailing.length >= faultThreshold &&
    trailing.every((reading) => reading.quality === 'invalid')
  ) {
    drafts.push(
      draft(latest, 'sensor-fault', 'warning', `${faultThreshold} consecutive invalid readings`, {
        consecutiveInvalid: faultThreshold,
      }),
    );
  }

  const ageMinutes = (now.getTime() - new Date(latest.recordedAt).getTime()) / 60_000;
  if (ageMinutes > thresholds.staleAfterMinutes) {
    drafts.push(
      draft(
        latest,
        'stale-reading',
        'warning',
        `Latest reading is ${ageMinutes.toFixed(0)} minutes old`,
        {
          ageMinutes: round2(ageMinutes),
        },
      ),
    );
  }

  return {
    drafts,
    estimatedNetVolumeLitres: latest.netVolumeLitres,
    fillPercent: percent,
  };
}

function draftsFromStaleState(
  input: AlarmEvaluationInput,
  reason: string,
): ReadonlyArray<AlarmDraft> {
  const thresholds = input.tank.thresholds ?? DEFAULT_TANK_THRESHOLDS;
  const latestAny = input.readings[input.readings.length - 1];
  const drafts: AlarmDraft[] = [
    {
      tankId: input.tank.id,
      type: 'stale-reading',
      severity: 'warning',
      message: `No usable readings available (${reason})`,
      readingId: latestAny?.id ?? null,
      metrics: { staleAfterMinutes: thresholds.staleAfterMinutes },
    },
  ];

  const trailingInvalid = input.readings.slice(-DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT);
  if (
    trailingInvalid.length >= DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT &&
    trailingInvalid.every((reading) => reading.quality === 'invalid')
  ) {
    drafts.push({
      tankId: input.tank.id,
      type: 'sensor-fault',
      severity: 'warning',
      message: 'All recent readings were invalid',
      readingId: latestAny?.id ?? null,
      metrics: { consecutiveInvalid: DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT },
    });
  }

  return drafts;
}

function draft(
  reading: TankReading,
  type: AlarmType,
  severity: AlarmSeverity,
  message: string,
  metrics: Readonly<Record<string, number>>,
): AlarmDraft {
  return { tankId: reading.tankId, type, severity, message, readingId: reading.id, metrics };
}

function dropLitresPerHour(previous: TankReading, latest: TankReading): number | null {
  const minutes = minutesBetween(previous, latest);
  if (minutes === null || minutes <= 0) {
    return null;
  }
  const lost = previous.netVolumeLitres - latest.netVolumeLitres;
  if (lost <= 0) {
    return null;
  }
  return lost / (minutes / 60);
}

function minutesBetween(previous: TankReading, latest: TankReading): number | null {
  const start = new Date(previous.recordedAt).getTime();
  const end = new Date(latest.recordedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return (end - start) / 60_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Returns only the drafts whose (tankId, type) pair is not already represented
 * by an open alarm, so a persisted condition does not spam new records.
 */
export function selectNewAlarmDrafts(
  drafts: ReadonlyArray<AlarmDraft>,
  openAlarms: ReadonlyArray<Alarm>,
): ReadonlyArray<AlarmDraft> {
  const openKeys = new Set(openAlarms.map((alarm) => `${alarm.tankId}:${alarm.type}`));
  return drafts.filter((candidate) => !openKeys.has(`${candidate.tankId}:${candidate.type}`));
}

/** Open alarms whose condition no longer appears in the current drafts. */
export function selectResolvedAlarms(
  drafts: ReadonlyArray<AlarmDraft>,
  openAlarms: ReadonlyArray<Alarm>,
): ReadonlyArray<Alarm> {
  const active = new Set(drafts.map((candidate) => `${candidate.tankId}:${candidate.type}`));
  return openAlarms.filter((alarm) => !active.has(`${alarm.tankId}:${alarm.type}`));
}

export function materializeAlarm(
  draft: AlarmDraft,
  tenantId: TenantId,
  now: Date,
  id: AlarmId = newId('alm') as AlarmId,
): Alarm {
  return {
    id,
    tenantId,
    tankId: draft.tankId,
    type: draft.type,
    severity: draft.severity,
    status: 'open',
    message: draft.message,
    raisedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    readingId: draft.readingId,
    metrics: draft.metrics,
  };
}
