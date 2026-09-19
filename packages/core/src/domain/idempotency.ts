import { createHash } from 'node:crypto';
import type { TankId, TenantId } from '../types/ids.js';

/**
 * Idempotency protects the fuel ledger from the most common field failure:
 * a probe that loses its connection mid-upload and resends the same
 * observation. Without a key the platform would store the same dip twice and
 * report a drop or a delivery that never happened.
 */
export interface IdempotencyScope {
  readonly tenantId: TenantId;
  readonly tankId: TankId;
  readonly deviceId: string | null;
  /** ISO 8601 timestamp exactly as the device reported it. */
  readonly observedAt: string;
}

/**
 * A client supplied key must be printable, bounded and long enough to be
 * unique per submission. Devices are expected to send a UUID or a
 * device-sequence pair such as `sim-01-000931`.
 */
const CLIENT_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export const CLIENT_IDEMPOTENCY_KEY_MIN = 8;
export const CLIENT_IDEMPOTENCY_KEY_MAX = 200;

export function isClientIdempotencyKey(value: string): boolean {
  return CLIENT_KEY_PATTERN.test(value);
}

/**
 * Canonicalises an ISO 8601 timestamp to the instant it denotes, so that
 * `11:40:00Z` and `13:40:00+02:00` produce the same key. A value that cannot
 * be parsed is used verbatim rather than silently collapsed, because a
 * malformed timestamp is rejected earlier by request validation.
 */
function observedInstant(observedAt: string): string {
  const parsed = Date.parse(observedAt);
  return Number.isNaN(parsed) ? observedAt : String(parsed);
}

/**
 * Derives a stable key from the submission identity. The tenant id is part of
 * the scope so that two tenants reporting the same tank, device and instant
 * can never collapse into a single reading.
 */
export function deriveIdempotencyKey(scope: IdempotencyScope): string {
  const canonical = [
    scope.tenantId,
    scope.tankId,
    scope.deviceId ?? 'unassigned',
    observedInstant(scope.observedAt),
  ].join('|');
  return `idem_${createHash('sha256').update(canonical).digest('hex').slice(0, 48)}`;
}
