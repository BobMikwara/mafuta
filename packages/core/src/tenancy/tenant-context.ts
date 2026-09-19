import { AsyncLocalStorage } from 'node:async_hooks';
import { UnauthorizedError } from '../errors.js';
import type { ApiKeyId, PrincipalId, TenantId } from '../types/ids.js';

/**
 * The only supported way to learn "which tenant is this operation for".
 * Repositories additionally require an explicit tenantId argument so that a
 * missing context can never result in an unscoped query.
 */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly principalId: PrincipalId;
  readonly apiKeyId: ApiKeyId;
  readonly scopes: ReadonlyArray<string>;
  readonly requestId?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function requireTenantContext(): TenantContext {
  const context = storage.getStore();
  if (context === undefined) {
    throw new UnauthorizedError('No tenant context is bound to this operation');
  }
  return context;
}

export function hasScope(scope: string): boolean {
  const context = getTenantContext();
  return context !== undefined && context.scopes.includes(scope);
}
