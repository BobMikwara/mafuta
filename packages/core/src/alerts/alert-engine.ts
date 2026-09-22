import {
  DEFAULT_DEVICE_OFFLINE_MINUTES,
  isDeviceOffline,
  minutesSinceLastSeen,
  type Device,
  type DeviceAssignment,
} from '../domain/device.js';
import { netVolumeMl, type TankReading } from '../domain/reading.js';
import {
  DEFAULT_TANK_THRESHOLDS,
  fillPercentMl,
  type Tank,
  type TankThresholds,
} from '../domain/tank.js';
import type { Alert, AlertDraft, AlertSeverity, AlertType } from '../domain/alert.js';
import { newId, type AlertId, type TenantId } from '../types/ids.js';

/**
 * Rule based, explainable alert evaluation (TRD section 6).
 *
 * Every rule below is documented in `docs/alert-rules.md`. Each draft carries
 * the measurements that produced it, so an operator can check the arithmetic
 * instead of trusting the badge.
 */
export interface TankDeviceOnTank {
  readonly device: Device;
  readonly assignment: DeviceAssignment;
}

export interface AlertEvaluationInput {
  readonly tenantId: TenantId;
  readonly tank: Tank;
  /** Readings for this tank, ascending by `recordedAt`. */
  readonly readings: ReadonlyArray<TankReading>;
  /** Current time used for staleness and offline calculation. */
  readonly now: Date;
  /** Devices currently assigned to this tank, for the offline rule. */
  readonly assignedDevices?: ReadonlyArray<TankDeviceOnTank>;
  /** Overrides the platform default offline window. */
  readonly deviceOfflineAfterMinutes?: number;
  /** Number of consecutive invalid readings that triggers a probe fault. */
  readonly consecutiveInvalidForFault?: number;
}

export interface AlertEvaluationResult {
  readonly drafts: ReadonlyArray<AlertDraft>;
  readonly estimatedNetVolumeMl: number | null;
  readonly fillPercent: number | null;
}

export const DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT = 3;

export function evaluateTankAlerts(input: AlertEvaluationInput): AlertEvaluationResult {
  const { tank, readings, now } = input;
  const thresholds: TankThresholds = tank.thresholds ?? DEFAULT_TANK_THRESHOLDS;
  const drafts: AlertDraft[] = [];

  const usable = readings.filter((reading) => reading.quality !== 'invalid');
  const latest = usable[usable.length - 1];
  const latestAny = readings[readings.length - 1];

  const deviceDrafts = evaluateDeviceAlerts(input);
  drafts.push(...deviceDrafts);

  if (latest === undefined) {
    return {
      drafts: [...drafts, ...draftsFromMissingData(input, 'no usable readings')],
      estimatedNetVolumeMl: null,
      fillPercent: null,
    };
  }

  const netMl = netVolumeMl(latest);
  const percent = fillPercentMl(tank, netMl);

  if (percent <= thresholds.criticalLowPercent) {
    drafts.push(
      draft(
        latest,
        'critical_stock',
        'critical',
        `Critical stock: ${percent.toFixed(1)}% of capacity`,
        {
          fillPercent: round2(percent),
          netVolumeLitres: latest.netVolumeLitres,
          thresholdPercent: thresholds.criticalLowPercent,
        },
      ),
    );
  } else if (percent <= thresholds.lowPercent) {
    drafts.push(
      draft(latest, 'low_stock', 'warning', `Low stock: ${percent.toFixed(1)}% of capacity`, {
        fillPercent: round2(percent),
        netVolumeLitres: latest.netVolumeLitres,
        thresholdPercent: thresholds.lowPercent,
      }),
    );
  }

  if (latest.waterLevelMm >= thresholds.waterAlarmMm) {
    drafts.push(
      draft(latest, 'water_level', 'warning', `Water level ${latest.waterLevelMm.toFixed(1)} mm`, {
        waterLevelMm: latest.waterLevelMm,
        thresholdMm: thresholds.waterAlarmMm,
      }),
    );
  }

  if (latest.quality === 'suspect') {
    drafts.push(
      draft(latest, 'probe_quality', 'warning', 'Latest reading is suspect', {
        quality: latest.quality,
        ...(latest.qualityReason === null ? {} : { reason: latest.qualityReason }),
        ...(latest.signalQualityPercent === null
          ? {}
          : { signalQualityPercent: latest.signalQualityPercent }),
      }),
    );
  }

  const faultThreshold = input.consecutiveInvalidForFault ?? DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT;
  const trailing = readings.slice(-faultThreshold);
  if (
    trailing.length >= faultThreshold &&
    trailing.every((reading) => reading.quality === 'invalid')
  ) {
    drafts.push(
      draft(
        latestAny ?? latest,
        'probe_quality',
        'critical',
        `${faultThreshold} consecutive invalid readings`,
        { consecutiveInvalid: faultThreshold, quality: 'invalid' },
      ),
    );
  }

  const ageMinutes = ageMinutesOf(latest, now);
  if (ageMinutes !== null && ageMinutes > thresholds.staleAfterMinutes) {
    drafts.push(
      draft(
        latest,
        'stale_data',
        'warning',
        `Latest reading is ${ageMinutes.toFixed(0)} minutes old`,
        {
          ageMinutes: round2(ageMinutes),
          staleAfterMinutes: thresholds.staleAfterMinutes,
        },
      ),
    );
  }

  return {
    drafts,
    estimatedNetVolumeMl: netMl,
    fillPercent: percent,
  };
}

/**
 * Offline alerts for every device currently attached to the tank. A device with
 * no `lastSeenAt` at all counts as offline, because a registered device that
 * has never reported is not delivering data.
 */
function evaluateDeviceAlerts(input: AlertEvaluationInput): ReadonlyArray<AlertDraft> {
  const assigned = input.assignedDevices ?? [];
  if (assigned.length === 0) {
    return [];
  }
  const offlineAfter = input.deviceOfflineAfterMinutes ?? DEFAULT_DEVICE_OFFLINE_MINUTES;
  const drafts: AlertDraft[] = [];

  for (const entry of assigned) {
    // A retired device is left out of offline alarms: it is no longer expected
    // to report. A device that is explicitly in maintenance is also expected to
    // be silent, so alerting on it would train operators to ignore the alert.
    if (entry.device.status === 'retired' || entry.device.status === 'maintenance') {
      continue;
    }
    if (!isDeviceOffline(entry.device, input.now, offlineAfter)) {
      continue;
    }
    const minutes = minutesSinceLastSeen(entry.device, input.now);
    drafts.push({
      tankId: input.tank.id,
      type: 'device_offline',
      severity: 'warning',
      message:
        minutes === null
          ? `Device ${entry.device.serialNumber} has never reported`
          : `Device ${entry.device.serialNumber} silent for ${minutes.toFixed(0)} minutes`,
      readingId: null,
      metrics: {
        deviceId: entry.device.id,
        serialNumber: entry.device.serialNumber,
        ...(minutes === null ? {} : { silentMinutes: round2(minutes) }),
        offlineAfterMinutes: offlineAfter,
      },
    });
  }

  return drafts;
}

function draftsFromMissingData(
  input: AlertEvaluationInput,
  reason: string,
): ReadonlyArray<AlertDraft> {
  const thresholds = input.tank.thresholds ?? DEFAULT_TANK_THRESHOLDS;
  const latestAny = input.readings[input.readings.length - 1];
  const drafts: AlertDraft[] = [
    {
      tankId: input.tank.id,
      type: 'stale_data',
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
      type: 'probe_quality',
      severity: 'critical',
      message: 'All recent readings were invalid',
      readingId: latestAny?.id ?? null,
      metrics: { consecutiveInvalid: DEFAULT_CONSECUTIVE_INVALID_FOR_FAULT },
    });
  }

  return drafts;
}

function draft(
  reading: TankReading,
  type: AlertType,
  severity: AlertSeverity,
  message: string,
  metrics: AlertDraft['metrics'],
): AlertDraft {
  return { tankId: reading.tankId, type, severity, message, readingId: reading.id, metrics };
}

function ageMinutesOf(reading: TankReading, now: Date): number | null {
  const recorded = Date.parse(reading.recordedAt);
  if (Number.isNaN(recorded)) {
    return null;
  }
  return (now.getTime() - recorded) / 60_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Returns only the drafts whose (tankId, type) pair is not already represented
 * by an open alert, so a persisted condition does not spam new records.
 */
export function selectNewAlertDrafts(
  drafts: ReadonlyArray<AlertDraft>,
  openAlerts: ReadonlyArray<Alert>,
): ReadonlyArray<AlertDraft> {
  const openKeys = new Set(openAlerts.map((alert) => alertKey(alert.tankId, alert.type)));
  return drafts.filter((candidate) => !openKeys.has(alertKey(candidate.tankId, candidate.type)));
}

/** Open alerts whose condition no longer appears in the current drafts. */
export function selectResolvedAlerts(
  drafts: ReadonlyArray<AlertDraft>,
  openAlerts: ReadonlyArray<Alert>,
): ReadonlyArray<Alert> {
  const active = new Set(drafts.map((candidate) => alertKey(candidate.tankId, candidate.type)));
  return openAlerts.filter((alert) => !active.has(alertKey(alert.tankId, alert.type)));
}

function alertKey(tankId: string | null, type: AlertType): string {
  return `${tankId ?? 'tenant'}:${type}`;
}

export function materializeAlert(
  draft: AlertDraft,
  tenantId: TenantId,
  now: Date,
  id: AlertId = newId('alt') as AlertId,
): Alert {
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
    acknowledgedAt: null,
    acknowledgedBy: null,
    assignedTo: null,
    resolvedAt: null,
    resolvedBy: null,
    metrics: draft.metrics,
  };
}
