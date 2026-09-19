import type { AlarmId, ReadingId, TankId, TenantId } from '../types/ids.js';

export const ALARM_TYPES = [
  'critical-low-level',
  'low-level',
  'high-level',
  'rapid-drop',
  'water-ingress',
  'sensor-fault',
  'stale-reading',
  'delivery-detected',
] as const;

export type AlarmType = (typeof ALARM_TYPES)[number];

export type AlarmSeverity = 'info' | 'warning' | 'critical';

export type AlarmStatus = 'open' | 'acknowledged' | 'resolved';

export interface Alarm {
  readonly id: AlarmId;
  readonly tenantId: TenantId;
  readonly tankId: TankId;
  readonly type: AlarmType;
  readonly severity: AlarmSeverity;
  readonly status: AlarmStatus;
  readonly message: string;
  readonly raisedAt: string;
  readonly updatedAt: string;
  readonly readingId: ReadingId | null;
  /** Numeric evidence attached to the alarm for audit and tuning. */
  readonly metrics: Readonly<Record<string, number>>;
}

/** An alarm candidate produced by the rules engine before persistence. */
export interface AlarmDraft {
  readonly tankId: TankId;
  readonly type: AlarmType;
  readonly severity: AlarmSeverity;
  readonly message: string;
  readonly readingId: ReadingId | null;
  readonly metrics: Readonly<Record<string, number>>;
}

export const ALARM_SEVERITY_WEIGHT: Record<AlarmSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function isOpenAlarm(alarm: Alarm): boolean {
  return alarm.status === 'open' || alarm.status === 'acknowledged';
}
