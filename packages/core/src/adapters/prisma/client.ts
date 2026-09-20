import { PrismaClient } from '@prisma/client';
import { REQUIRED_TABLES, requiredTablesSqlList, type SchemaStatus } from './migrate.js';

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

/**
 * Tells "database unreachable" apart from "database reachable but never
 * migrated". Both surface as a 401 on every `/v1/*` request, because the API
 * key lookup is the first query of the request, but they need different
 * operator actions: fix the connection string, or apply migrations.
 *
 * Never throws. A driver failure becomes `status: 'unknown'` with the error
 * name and Prisma code, which are safe to log but must not reach an HTTP body.
 */
export async function describePrismaSchemaStatus(): Promise<SchemaStatus> {
  const prisma = getPrismaClient();
  try {
    // Static SQL built from a compile time constant table list, so the tagged
    // template needs no parameters and there is nothing to inject.
    const rows: Array<{ table_name: string }> = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (${requiredTablesSqlList()})`;
    const present = new Set(rows.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table));
    return missingTables.length === 0
      ? { status: 'migrated' }
      : { status: 'unmigrated', missingTables };
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown';
    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    return { status: 'unknown', reason, ...(code === undefined ? {} : { code }) };
  }
}
