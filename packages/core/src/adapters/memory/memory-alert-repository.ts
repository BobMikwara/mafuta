import { clampLimit, type AlertQuery, type AlertRepository } from '../../ports/repositories.js';
import { isOpenAlert, type Alert } from '../../domain/alert.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';
import type { AlertId, TankId, TenantId } from '../../types/ids.js';
import { cloneEntity, scopedKey, type MemoryStore } from './memory-store.js';

export function createMemoryAlertRepository(store: MemoryStore): AlertRepository {
  function tenantAlerts(tenantId: TenantId): Array<Alert> {
    return [...store.alerts.values()]
      .filter((alert) => alert.tenantId === tenantId)
      .sort((left, right) => Date.parse(right.raisedAt) - Date.parse(left.raisedAt));
  }

  return {
    async save(tenantId: TenantId, alert: Alert): Promise<Alert> {
      assertOwnedByTenant(tenantId, alert, 'alerts.save');
      const stored = cloneEntity(alert);
      store.alerts.set(scopedKey(tenantId, alert.id), stored);
      return cloneEntity(stored);
    },
    async update(tenantId: TenantId, alert: Alert): Promise<Alert> {
      assertOwnedByTenant(tenantId, alert, 'alerts.update');
      const stored = cloneEntity(alert);
      store.alerts.set(scopedKey(tenantId, alert.id), stored);
      return cloneEntity(stored);
    },
    async findById(tenantId: TenantId, id: AlertId): Promise<Alert | null> {
      const alert = store.alerts.get(scopedKey(tenantId, id));
      return alert === undefined ? null : cloneEntity(alert);
    },
    async list(tenantId: TenantId, query: AlertQuery = {}): Promise<ReadonlyArray<Alert>> {
      const alerts = tenantAlerts(tenantId)
        .filter((alert) => query.tankId === undefined || alert.tankId === query.tankId)
        .filter((alert) => query.status === undefined || alert.status === query.status)
        .filter((alert) => query.type === undefined || alert.type === query.type);
      return alerts.slice(0, clampLimit(query.limit)).map(cloneEntity);
    },
    async listOpenByTank(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<Alert>> {
      return tenantAlerts(tenantId)
        .filter((alert) => alert.tankId === tankId && isOpenAlert(alert))
        .map(cloneEntity);
    },
    async countOpen(tenantId: TenantId): Promise<number> {
      return tenantAlerts(tenantId).filter((alert) => alert.status === 'open').length;
    },
  };
}
