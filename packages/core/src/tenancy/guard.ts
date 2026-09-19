import { TenantIsolationError } from '../errors.js';
import type { TenantId } from '../types/ids.js';

interface Owned {
  readonly tenantId: TenantId;
}

/**
 * Defence in depth: every repository and service boundary re-checks the tenant
 * of the entity it is about to persist or return. A violation throws instead of
 * silently returning another tenant's data.
 */
export function assertOwnedByTenant<T extends Owned>(
  tenantId: TenantId,
  entity: T,
  operation: string,
): T {
  if (entity.tenantId !== tenantId) {
    throw new TenantIsolationError(tenantId, entity.tenantId, operation);
  }
  return entity;
}

export function assertAllOwnedByTenant<T extends Owned>(
  tenantId: TenantId,
  entities: ReadonlyArray<T>,
  operation: string,
): ReadonlyArray<T> {
  for (const entity of entities) {
    assertOwnedByTenant(tenantId, entity, operation);
  }
  return entities;
}

export function filterByTenant<T extends Owned>(
  tenantId: TenantId,
  entities: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return entities.filter((entity) => entity.tenantId === tenantId);
}
