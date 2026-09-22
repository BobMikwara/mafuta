import type { FastifyRequest } from 'fastify';
import {
  enforceRateLimit,
  hashClientAddress,
  type AuditActor,
  type RateLimiter,
} from '@fueltrack/core';

/**
 * Helpers shared by every route module.
 *
 * The tenant id is never a parameter here on purpose: it always comes from
 * `request.tenantContext`, which the authentication hook sets from the API key.
 */

/** Scopes granted to the calling credential. */
export function scopeOf(request: FastifyRequest): ReadonlySet<string> {
  return new Set(request.tenantContext?.scopes ?? []);
}

export function hasScope(request: FastifyRequest, scope: string): boolean {
  return scopeOf(request).has(scope);
}

/**
 * Actor recorded in the audit trail. The client address is hashed with a server
 * side secret, so an investigator can correlate entries without the platform
 * storing personal data.
 */
export function actorFrom(request: FastifyRequest, ipHashSecret?: string): AuditActor {
  const context = request.tenantContext;
  return {
    type: 'system',
    reference: context === undefined ? null : String(context.principalId),
    ipHash: hashClientAddress(request.ip, ipHashSecret),
  };
}

/**
 * Identity used for rate limiting: the credential when there is one, otherwise
 * the client address. Never the tenant, because one tenant may legitimately run
 * many credentials and should not have them share a budget.
 */
export function rateLimitIdentity(request: FastifyRequest): string {
  return request.tenantContext?.apiKeyId ?? `ip:${request.ip}`;
}

/**
 * Applies a limiter to a specific operation. Called at the start of the handler
 * so the work is refused before any query runs.
 */
export function applyRateLimit(
  limiter: RateLimiter | undefined,
  request: FastifyRequest,
  operation: string,
): void {
  if (limiter === undefined) {
    return;
  }
  enforceRateLimit(limiter, `${operation}:${rateLimitIdentity(request)}`);
}

export type { AuditActor };
