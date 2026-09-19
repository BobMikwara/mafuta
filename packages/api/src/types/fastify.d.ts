import type { TenantContext } from '@fueltrack/core';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the authentication hook for every /v1 route. */
    tenantContext?: TenantContext;
  }
}

export {};
