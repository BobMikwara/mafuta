import { createHash, createHmac } from 'node:crypto';

/**
 * Hashes a client address for the audit log.
 *
 * TRD section 7 requires privileged actions to be auditable without collecting
 * personal data: a keyed hash lets an investigator correlate entries from one
 * client without the address itself ever being stored. When no audit secret is
 * configured the value is omitted rather than stored in the clear.
 */
export function hashClientAddress(
  address: string | undefined,
  secret: string | undefined,
): string | null {
  if (address === undefined || address === '' || secret === undefined || secret === '') {
    return null;
  }
  return `sha256:${createHmac('sha256', secret).update(address).digest('hex').slice(0, 32)}`;
}

/**
 * Stable fingerprint of an untrusted payload, used to deduplicate raw device
 * messages before normalization. The algorithm is not a credential hash: it
 * only has to be stable.
 */
export function payloadFingerprint(payload: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex').slice(0, 48)}`;
}

/**
 * JSON with object keys in sorted order, so that two payloads that differ only
 * in key order share one fingerprint.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      result[key] = canonicalize(entryValue);
    }
    return result;
  }
  return value;
}
