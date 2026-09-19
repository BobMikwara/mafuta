import {
  isApiKeyUsable,
  verifyApiKeySecret,
  type ApiKeyRecord,
  type ApiKeyRegistry,
} from '../../tenancy/api-key.js';
import { constantTimeEqual, hashApiKey } from '../../tenancy/api-key.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type { ApiKeyId, TenantId } from '../../types/ids.js';

export type StoredApiKey = Omit<ApiKeyRecord, 'keyHash'>;

export interface MemoryApiKeyRegistry extends ApiKeyRegistry {
  /** Test helper: number of credentials currently stored. */
  size(): number;
}

/**
 * Reference implementation. Lookup is a linear constant-time scan, which is
 * acceptable for tests and single node demos only. A production registry must
 * index on a non-secret key prefix and then compare hashes.
 */
export function createMemoryApiKeyRegistry(options?: { clock?: () => Date }): MemoryApiKeyRegistry {
  const now = options?.clock ?? (() => new Date());
  const records = new Map<string, ApiKeyRecord>();

  return {
    async findBySecret(secret: string): Promise<ApiKeyRecord | null> {
      const presentedHash = hashApiKey(secret);
      for (const record of records.values()) {
        if (!isApiKeyUsable(record, now())) {
          continue;
        }
        if (constantTimeEqual(presentedHash, record.keyHash)) {
          return { ...record, scopes: [...record.scopes] };
        }
      }
      return null;
    },
    async save(record: ApiKeyRecord): Promise<void> {
      records.set(record.id, { ...record, scopes: [...record.scopes] });
    },
    async touchLastUsed(id: ApiKeyId, usedAt: string): Promise<void> {
      const record = records.get(id);
      if (record === undefined) {
        return;
      }
      records.set(id, { ...record, lastUsedAt: usedAt });
    },
    async revoke(tenantId: TenantId, id: ApiKeyId): Promise<boolean> {
      const record = records.get(id);
      if (record === undefined) {
        return false;
      }
      assertOwnedByTenant(tenantId, record, 'apiKeys.revoke');
      records.set(id, { ...record, status: 'revoked' });
      return true;
    },
    async list(tenantId: TenantId): Promise<ReadonlyArray<StoredApiKey>> {
      return [...records.values()]
        .filter((record) => record.tenantId === tenantId)
        .map(({ keyHash: _keyHash, ...rest }) => ({ ...rest, scopes: [...rest.scopes] }));
    },
    size: () => records.size,
  };
}

export { verifyApiKeySecret };
