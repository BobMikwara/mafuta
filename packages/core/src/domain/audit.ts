import type { TenantId } from '../types/ids.js';

/**
 * Audit trail for privileged actions (TRD section 7, PRD section 5).
 *
 * Only non-secret metadata is recorded. Raw IP addresses are never stored: the
 * `ipHash` field holds a salted hash produced by the caller, or nothing at all.
 */
export const AUDIT_ACTOR_TYPES = ['user', 'device', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export type AuditMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditLogEntry {
  readonly id: string;
  readonly tenantId: TenantId | null;
  readonly actorType: AuditActorType;
  /** Principal reference (`key:<apiKeyId>`, `user:<userId>`) or null. */
  readonly actorReference: string | null;
  readonly actorDeviceId: string | null;
  /** Dotted action name such as `delivery.confirmed` or `export.downloaded`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  /** Salted hash of the client address, never the address itself. */
  readonly ipHash: string | null;
  readonly metadata: AuditMetadata;
  readonly occurredAt: string;
}

/** Actions that must always leave a trace. Kept in one place so it is testable. */
export const AUDITED_ACTIONS = [
  'tenant.created',
  'station.created',
  'station.updated',
  'tank.created',
  'tank.updated',
  'device.registered',
  'device.updated',
  'device.assigned',
  'device.unassigned',
  'reading.raw_payload_read',
  'event.confirmed',
  'event.rejected',
  'alert.acknowledged',
  'alert.resolved',
  'alert.assigned',
  'export.downloaded',
  'api_key.issued',
] as const;

export type AuditedAction = (typeof AUDITED_ACTIONS)[number];
