import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma_client__: PrismaClient | undefined;
}

/**
 * Singleton Prisma client for serverless environments.
 * Vercel reuses the same process for warm invocations, so we keep the client
 * on globalThis to avoid exhausting connections.
 */
export function getPrismaClient(): PrismaClient {
  if (globalThis.__prisma_client__ !== undefined) {
    return globalThis.__prisma_client__;
  }

  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__prisma_client__ = client;
  } else {
    // In production (Vercel) we also cache on globalThis to survive warm starts
    globalThis.__prisma_client__ = client;
  }

  return client;
}

/**
 * Readiness probe used by `/healthz`. Resolves when the database answers a
 * trivial query, rejects with the underlying Prisma/driver error otherwise.
 * The error is for operators (logs) only and must never be serialized into an
 * HTTP response, because it can contain connection-string fragments.
 */
export async function checkPrismaConnection(): Promise<void> {
  await getPrismaClient().$queryRaw`SELECT 1`;
}

export async function ensureTenantExists(tenantId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: {
      id: tenantId,
      name: tenantId,
      slug: tenantId,
      status: 'active',
      country: 'TZ',
      timezone: 'Africa/Dar_es_Salaam',
    },
  });
}
