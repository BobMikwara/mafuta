import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { newId, toApiKeyId, type ApiKeyId, type TenantId } from '../types/ids.js';

/**
 * API keys are the tenant boundary credential for device and server to server
 * traffic. Only a SHA-256 hash is ever stored, so a database leak does not
 * yield usable credentials.
 */
export type ApiKeyStatus = 'active' | 'revoked';

export interface ApiKeyRecord {
  readonly id: ApiKeyId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly keyHash: string;
  readonly scopes: ReadonlyArray<string>;
  readonly status: ApiKeyStatus;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
}

export const API_KEY_PREFIX = 'ftk';

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Compare against itself to keep the timing profile flat.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export interface GeneratedApiKey {
  readonly record: ApiKeyRecord;
  /** Returned exactly once, at creation time. Never persisted in clear text. */
  readonly secret: string;
}

export function generateApiKey(input: {
  tenantId: TenantId;
  name: string;
  scopes: ReadonlyArray<string>;
  createdAt: string;
  expiresAt?: string | null;
}): GeneratedApiKey {
  const id = toApiKeyId(newId('key'));
  const randomPart = randomBytes(32).toString('base64url');
  const secret = `${API_KEY_PREFIX}_${id}_${randomPart}`;
  const record: ApiKeyRecord = {
    id,
    tenantId: input.tenantId,
    name: input.name,
    keyHash: hashApiKey(secret),
    scopes: [...input.scopes],
    status: 'active',
    createdAt: input.createdAt,
    expiresAt: input.expiresAt ?? null,
    lastUsedAt: null,
  };
  return { record, secret };
}

export function isApiKeyUsable(record: ApiKeyRecord, now: Date): boolean {
  if (record.status !== 'active') {
    return false;
  }
  if (record.expiresAt === null) {
    return true;
  }
  return new Date(record.expiresAt).getTime() > now.getTime();
}

export function verifyApiKeySecret(secret: string, record: ApiKeyRecord): boolean {
  return constantTimeEqual(hashApiKey(secret), record.keyHash);
}

/**
 * Credential lookup port. Implementations must never expose the hash or the
 * secret through read models, logs or error messages.
 */
export interface ApiKeyRegistry {
  /** Resolves a presented secret to its record, or null when unknown. */
  findBySecret(secret: string): Promise<ApiKeyRecord | null>;
  save(record: ApiKeyRecord): Promise<void>;
  touchLastUsed(id: ApiKeyId, usedAt: string): Promise<void>;
  revoke(tenantId: TenantId, id: ApiKeyId): Promise<boolean>;
  list(tenantId: TenantId): Promise<ReadonlyArray<Omit<ApiKeyRecord, 'keyHash'>>>;
  /**
   * Number of credentials that could authenticate right now (active and not
   * expired) across every tenant. Deployment diagnostics only: it answers "can
   * anybody authenticate against this store at all", which is what separates a
   * missing credential from a rejected one. Never used for authorization and
   * never surfaced to an HTTP caller.
   */
  countUsable(): Promise<number>;
}
