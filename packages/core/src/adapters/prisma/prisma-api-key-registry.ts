import type { ApiKeyRecord, ApiKeyRegistry } from '../../tenancy/api-key.js';
import { isApiKeyUsable, hashApiKey, constantTimeEqual } from '../../tenancy/api-key.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type { ApiKeyId, TenantId } from '../../types/ids.js';
import { getPrismaClient, ensureTenantExists } from './client.js';

function toDomain(row: {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  scopes: string[];
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}): ApiKeyRecord {
  return {
    id: row.id as ApiKeyId,
    tenantId: row.tenantId as TenantId,
    name: row.name,
    keyHash: row.keyHash,
    scopes: [...row.scopes],
    status: (row.status === 'revoked' ? 'revoked' : 'active') as ApiKeyRecord['status'],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

export function createPrismaApiKeyRegistry(options?: { clock?: () => Date }): ApiKeyRegistry {
  const now = options?.clock ?? (() => new Date());

  return {
    async findBySecret(secret: string): Promise<ApiKeyRecord | null> {
      const prisma = getPrismaClient();
      const presentedHash = hashApiKey(secret);

      // We store hash uniquely, so we can lookup directly by hash
      // For security we still do constant time compare
      const row = await prisma.apiKey.findUnique({
        where: { keyHash: presentedHash },
      });

      if (!row) return null;
      if (!isApiKeyUsable(toDomain(row), now())) return null;

      // Constant time check (redundant with unique lookup but keeps timing flat)
      if (!constantTimeEqual(presentedHash, row.keyHash)) return null;

      return toDomain(row);
    },

    async save(record: ApiKeyRecord): Promise<void> {
      await ensureTenantExists(record.tenantId);
      const prisma = getPrismaClient();
      await prisma.apiKey.upsert({
        where: { id: record.id },
        update: {
          name: record.name,
          keyHash: record.keyHash,
          // Domain scopes are readonly; Prisma scalar lists are mutable arrays.
          scopes: [...record.scopes],
          status: record.status,
          expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
          lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
        },
        create: {
          id: record.id,
          tenantId: record.tenantId,
          name: record.name,
          keyHash: record.keyHash,
          scopes: [...record.scopes],
          status: record.status,
          createdAt: new Date(record.createdAt),
          expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
          lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt) : null,
        },
      });
    },

    async touchLastUsed(id: ApiKeyId, usedAt: string): Promise<void> {
      const prisma = getPrismaClient();
      await prisma.apiKey.updateMany({
        where: { id },
        data: { lastUsedAt: new Date(usedAt) },
      });
    },

    async revoke(tenantId: TenantId, id: ApiKeyId): Promise<boolean> {
      const prisma = getPrismaClient();
      const existing = await prisma.apiKey.findFirst({ where: { id, tenantId } });
      if (!existing) return false;
      assertOwnedByTenant(
        tenantId,
        { tenantId: existing.tenantId } as unknown as { tenantId: TenantId },
        'apiKeys.revoke',
      );
      await prisma.apiKey.update({
        where: { id },
        data: { status: 'revoked' },
      });
      return true;
    },

    async list(tenantId: TenantId): Promise<ReadonlyArray<Omit<ApiKeyRecord, 'keyHash'>>> {
      const prisma = getPrismaClient();
      const rows = await prisma.apiKey.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(
        (row: {
          id: string;
          tenantId: string;
          name: string;
          keyHash: string;
          scopes: string[];
          status: string;
          createdAt: Date;
          expiresAt: Date | null;
          lastUsedAt: Date | null;
        }) => {
          const domain = toDomain(row);
          const { keyHash: _keyHash, ...rest } = domain;
          return rest;
        },
      );
    },

    async countUsable(): Promise<number> {
      const prisma = getPrismaClient();
      // Mirrors isApiKeyUsable: active status and either no expiry or a future
      // expiry. Kept as a count so no key material ever leaves the database.
      return prisma.apiKey.count({
        where: {
          status: 'active',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }],
        },
      });
    },
  };
}
