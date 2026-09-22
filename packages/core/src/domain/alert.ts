import type { AlertId, ReadingId, TankId, TenantId } from '../types/ids.js';

/**
 * Operational alerts.
 *
 * PRD section 5 defines the alert taxonomy below. An alert is a sustained
 * operational condition; a candidate fuel event (delivery, unexplained
 * decrease) is a separate entity that requires a human decision and lives in
 * `domain/event.ts`. Conflating the two is what produced the earlier
 * "possible leak or theft" alarm wording.
 */
export const ALERT_TYPES = [
  'low_stock',
  'critical_stock',
  'device_offline',
  'stale_data',
  'probe_quality',
  'candidate_delivery',
  'candidate_unexplained_decrease',
  'water_level',
] as const;

/**
 * Overfill risk is deliberately *not* an alert type yet.
 *
 * The `AlertType` enum in `prisma/schema.prisma` is generated into the
 * database, and adding a value needs a migration that can only be verified
 * against a real PostgreSQL shadow database. Until that migration is written
 * and verified, the condition is surfaced as `overfillRisk` on the tank summary
 * in `domain/views.ts`, so the operator still sees it. See
 * `docs/spec-reconciliation.md`.
 */

export type AlertType = (typeof ALERT_TYPES)[number];

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

/**
 * Numeric or textual evidence attached to an alert. Stored as JSON so that a
 * later reviewer can see exactly which measurements raised the alert.
 */
export type AlertMetrics = Readonly<Record<string, number | string | boolean | null>>;

export interface Alert {
  readonly id: AlertId;
  readonly tenantId: TenantId;
  /** Null for platform-level alerts that are not tied to a tank. */
  readonly tankId: TankId | null;
  readonly type: AlertType;
  readonly severity: AlertSeverity;
  readonly status: AlertStatus;
  readonly message: string;
  readonly raisedAt: string;
  readonly updatedAt: string;
  readonly readingId: ReadingId | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly assignedTo: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly metrics: AlertMetrics;
}

/** An alert candidate produced by the rules engine before persistence. */
export interface AlertDraft {
  readonly tankId: TankId | null;
  readonly type: AlertType;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly readingId: ReadingId | null;
  readonly metrics: AlertMetrics;
}

export const ALERT_SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export const ALERT_STATUSES: ReadonlyArray<AlertStatus> = ['open', 'acknowledged', 'resolved'];

export function isOpenAlert(alert: Alert): boolean {
  return alert.status === 'open' || alert.status === 'acknowledged';
}

/**
 * Alert type that represents a candidate event in the alert list. A candidate
 * event and its alert are two views of the same observation: the alert is the
 * operational nudge, the event is the record that needs a decision.
 */
export function alertTypeForEventType(eventType: string): AlertType {
  return eventType === 'candidate_delivery'
    ? 'candidate_delivery'
    : 'candidate_unexplained_decrease';
}

export function isAlertType(value: string): value is AlertType {
  return (ALERT_TYPES as ReadonlyArray<string>).includes(value);
}
