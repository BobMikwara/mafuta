import { vi } from 'vitest';

/**
 * Shared fake of the generated `@prisma/client` surface, used by the adapter
 * unit tests. The Prisma adapters are thin: they scope every query by tenant,
 * delegate to the client and map rows through `mappers.ts`. A controllable fake
 * exercises exactly those mechanics without a database or the generated
 * client, which is what a freshly cloned workspace has not got. The same
 * adapters are proven over a real socket by the integration tests that run
 * wherever a PostgreSQL server is reachable.
 *
 * Import `mockPrisma` in tests and install the module replacement with:
 *
 *   vi.mock('@prisma/client', async () => {
 *     const { MockPrismaClient } = await import('./prisma-mock.js');
 *     return { PrismaClient: MockPrismaClient };
 *   });
 */

export interface MockModel {
  readonly findMany: ReturnType<typeof vi.fn>;
  readonly findFirst: ReturnType<typeof vi.fn>;
  readonly findUnique: ReturnType<typeof vi.fn>;
  readonly create: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
  readonly updateMany: ReturnType<typeof vi.fn>;
  readonly upsert: ReturnType<typeof vi.fn>;
  readonly count: ReturnType<typeof vi.fn>;
}

export interface MockPrisma {
  readonly tenant: MockModel;
  readonly station: MockModel;
  readonly tank: MockModel;
  readonly tankReading: MockModel;
  readonly alert: MockModel;
  readonly device: MockModel;
  readonly deviceAssignment: MockModel;
  readonly fuelEvent: MockModel;
  readonly delivery: MockModel;
  readonly auditLog: MockModel;
  readonly rawDeviceMessage: MockModel;
  readonly apiKey: MockModel;
  readonly $queryRaw: ReturnType<typeof vi.fn>;
}

function createModel(): MockModel {
  return {
    findMany: vi.fn(async (): Promise<unknown> => []),
    findFirst: vi.fn(async (): Promise<unknown> => null),
    findUnique: vi.fn(async (): Promise<unknown> => null),
    create: vi.fn(async (): Promise<unknown> => ({})),
    update: vi.fn(async (): Promise<unknown> => ({})),
    updateMany: vi.fn(async (): Promise<unknown> => ({ count: 0 })),
    upsert: vi.fn(async (): Promise<unknown> => ({})),
    count: vi.fn(async (): Promise<unknown> => 0),
  };
}

function resetModel(model: MockModel): void {
  model.findMany.mockReset().mockResolvedValue([]);
  model.findFirst.mockReset().mockResolvedValue(null);
  model.findUnique.mockReset().mockResolvedValue(null);
  model.create.mockReset().mockResolvedValue({});
  model.update.mockReset().mockResolvedValue({});
  model.updateMany.mockReset().mockResolvedValue({ count: 0 });
  model.upsert.mockReset().mockResolvedValue({});
  model.count.mockReset().mockResolvedValue(0);
}

const MODELS = [
  'tenant',
  'station',
  'tank',
  'tankReading',
  'alert',
  'device',
  'deviceAssignment',
  'fuelEvent',
  'delivery',
  'auditLog',
  'rawDeviceMessage',
  'apiKey',
] as const;

function buildMockPrisma(): MockPrisma {
  const models: Record<string, MockModel> = {};
  for (const name of MODELS) {
    models[name] = createModel();
  }
  return {
    ...models,
    $queryRaw: vi.fn(async (): Promise<unknown> => []),
  } as unknown as MockPrisma;
}

/** The single shared instance every mocked `new PrismaClient()` returns. */
export const mockPrisma: MockPrisma = buildMockPrisma();

/** Restores default return values and clears recorded calls between tests. */
export function resetMockPrisma(): void {
  for (const name of MODELS) {
    resetModel(mockPrisma[name]);
  }
  mockPrisma.$queryRaw.mockReset().mockResolvedValue([]);
  lastClientOptions = null;
}

/** Clears the singleton cache `client.ts` keeps on globalThis. */
export function clearPrismaClientCache(): void {
  globalThis.__prisma_client__ = undefined;
}

let lastClientOptions: unknown = null;

export function lastPrismaClientOptions(): unknown {
  return lastClientOptions;
}

/** Drop-in replacement for the generated `PrismaClient` constructor. */
export class MockPrismaClient {
  constructor(options?: unknown) {
    lastClientOptions = options ?? null;
    // A constructor may return a replacement object; the adapters then see the
    // shared mock wherever they call getPrismaClient().
    return mockPrisma as unknown as MockPrismaClient;
  }
}
