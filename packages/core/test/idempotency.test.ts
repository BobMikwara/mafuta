import { describe, expect, it } from 'vitest';
import {
  deriveIdempotencyKey,
  isClientIdempotencyKey,
  type IdempotencyScope,
} from '../src/domain/idempotency.js';
import { TENANT_A, TENANT_B } from './factories.js';

const SCOPE: IdempotencyScope = {
  tenantId: TENANT_A,
  tankId: 'tank-1' as never,
  deviceId: 'probe-1',
  observedAt: '2026-01-01T00:00:00.000Z',
};

describe('idempotency key derivation', () => {
  it('is stable for the same submission', () => {
    expect(deriveIdempotencyKey(SCOPE)).toBe(deriveIdempotencyKey({ ...SCOPE }));
    expect(deriveIdempotencyKey(SCOPE)).toMatch(/^idem_[0-9a-f]{48}$/);
  });

  it('separates two observations taken at different times', () => {
    const later = deriveIdempotencyKey({ ...SCOPE, observedAt: '2026-01-01T00:05:00.000Z' });
    expect(later).not.toBe(deriveIdempotencyKey(SCOPE));
  });

  it('separates two devices reporting the same tank at the same instant', () => {
    const otherDevice = deriveIdempotencyKey({ ...SCOPE, deviceId: 'probe-2' });
    expect(otherDevice).not.toBe(deriveIdempotencyKey(SCOPE));
  });

  it('separates two tanks', () => {
    const otherTank = deriveIdempotencyKey({ ...SCOPE, tankId: 'tank-2' as never });
    expect(otherTank).not.toBe(deriveIdempotencyKey(SCOPE));
  });

  it('never collapses two tenants onto one key', () => {
    // The tenant is part of the scope precisely so that two customers sharing
    // a device identifier cannot overwrite each other's readings.
    const otherTenant = deriveIdempotencyKey({ ...SCOPE, tenantId: TENANT_B });
    expect(otherTenant).not.toBe(deriveIdempotencyKey(SCOPE));
  });

  it('treats a device with no identifier as its own scope', () => {
    const unassigned = deriveIdempotencyKey({ ...SCOPE, deviceId: null });
    expect(unassigned).not.toBe(deriveIdempotencyKey(SCOPE));
  });

  it('canonicalises equivalent timestamps written in different offsets', () => {
    const utc = deriveIdempotencyKey({ ...SCOPE, observedAt: '2026-01-01T11:40:00.000Z' });
    const plusTwo = deriveIdempotencyKey({ ...SCOPE, observedAt: '2026-01-01T13:40:00.000+02:00' });
    expect(plusTwo).toBe(utc);
  });

  it('keeps an unparseable timestamp verbatim instead of collapsing it', () => {
    const bogus = deriveIdempotencyKey({ ...SCOPE, observedAt: 'not-a-timestamp' });
    const otherBogus = deriveIdempotencyKey({ ...SCOPE, observedAt: 'also-not-a-timestamp' });
    expect(bogus).not.toBe(otherBogus);
  });
});

describe('client supplied idempotency keys', () => {
  it('accepts printable bounded keys', () => {
    for (const value of [
      '12345678',
      'b3f1c0de-0000-4000-8000-000000000000',
      'probe-01:000931',
      'device_1.2026-01-01T00:00:00Z',
    ]) {
      expect(isClientIdempotencyKey(value)).toBe(true);
    }
  });

  it('rejects keys that are too short, too long or not printable', () => {
    for (const value of [
      'short',
      'x'.repeat(201),
      'has spaces in it',
      'has/slashes',
      'has|pipes',
      'emoji-\u{1F600}',
      '',
    ]) {
      expect(isClientIdempotencyKey(value)).toBe(false);
    }
  });
});
