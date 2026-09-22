import {
  clampLimit,
  type AuditLogRepository,
  type AuditQuery,
  type RawMessageRecord,
  type RawMessageRepository,
} from '../../ports/repositories.js';
import type { AuditLogEntry } from '../../domain/audit.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type { DeviceId, RawMessageId, TenantId } from '../../types/ids.js';
import { cloneEntity, scopedKey, type MemoryStore } from './memory-store.js';

export function createMemoryAuditLogRepository(store: MemoryStore): AuditLogRepository {
  return {
    async append(entry: AuditLogEntry): Promise<AuditLogEntry> {
      if (entry.tenantId !== null) {
        assertOwnedByTenant(entry.tenantId, { tenantId: entry.tenantId }, 'audit.append');
      }
      const stored = cloneEntity(entry);
      store.auditLogs.set(entry.id, stored);
      return cloneEntity(stored);
    },
    async list(tenantId: TenantId, query: AuditQuery = {}): Promise<ReadonlyArray<AuditLogEntry>> {
      const from = query.from === undefined ? null : Date.parse(query.from);
      const to = query.to === undefined ? null : Date.parse(query.to);
      const entries = [...store.auditLogs.values()]
        .filter((entry) => entry.tenantId === tenantId)
        .filter((entry) => query.action === undefined || entry.action === query.action)
        .filter(
          (entry) => query.resourceType === undefined || entry.resourceType === query.resourceType,
        )
        .filter((entry) => {
          const at = Date.parse(entry.occurredAt);
          if (from !== null && at < from) return false;
          if (to !== null && at > to) return false;
          return true;
        })
        .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
      return entries.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
  };
}

export function createMemoryRawMessageRepository(store: MemoryStore): RawMessageRepository {
  return {
    async save(tenantId: TenantId, record: RawMessageRecord): Promise<RawMessageRecord> {
      assertOwnedByTenant(tenantId, record, 'rawMessages.save');
      const existing = [...store.rawMessages.values()].find(
        (candidate) =>
          candidate.tenantId === tenantId && candidate.messageHash === record.messageHash,
      );
      if (existing !== undefined) {
        return cloneEntity(existing);
      }
      const stored = cloneEntity(record);
      store.rawMessages.set(scopedKey(tenantId, record.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: RawMessageId): Promise<RawMessageRecord | null> {
      const record = store.rawMessages.get(scopedKey(tenantId, id));
      return record === undefined ? null : cloneEntity(record);
    },
    async findByHash(tenantId: TenantId, messageHash: string): Promise<RawMessageRecord | null> {
      const record = [...store.rawMessages.values()].find(
        (candidate) => candidate.tenantId === tenantId && candidate.messageHash === messageHash,
      );
      return record === undefined ? null : cloneEntity(record);
    },
    async listByDevice(
      tenantId: TenantId,
      deviceId: DeviceId,
      limit?: number,
    ): Promise<ReadonlyArray<RawMessageRecord>> {
      return [...store.rawMessages.values()]
        .filter((record) => record.tenantId === tenantId && record.deviceId === deviceId)
        .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
        .slice(0, clampLimit(limit))
        .map(cloneEntity);
    },
  };
}
