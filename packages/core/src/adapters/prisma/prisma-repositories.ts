import type {
  Repositories,
  SiteRepository,
  TankRepository,
  ReadingRepository,
  AlarmRepository,
  SiteQuery,
  TankQuery,
  ReadingQuery,
  AlarmQuery,
} from '../../ports/repositories.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../ports/repositories.js';
import type { Site } from '../../domain/site.js';
import type { Tank } from '../../domain/tank.js';
import type { TankReading } from '../../domain/reading.js';
import type { Alarm } from '../../domain/alarm.js';
import { isOpenAlarm } from '../../domain/alarm.js';
import type { SiteId, TankId, TenantId, ReadingId, AlarmId } from '../../types/ids.js';
import { getPrismaClient, ensureTenantExists } from './client.js';
import {
  toDomainSite,
  toPrismaStationInput,
  toDomainTank,
  toPrismaTankInput,
  toDomainReading,
  toPrismaReadingInput,
  toDomainAlarm,
  toPrismaAlertInput,
} from './mappers.js';
import { assertOwnedByTenant } from '../../tenancy/guard.js';

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

// -------------------- Sites (Stations) --------------------

class PrismaSiteRepository implements SiteRepository {
  async save(tenantId: TenantId, site: Site): Promise<Site> {
    assertOwnedByTenant(tenantId, site, 'sites.save');
    await ensureTenantExists(tenantId);
    const prisma = getPrismaClient();
    const input = toPrismaStationInput(site);

    const row = await prisma.station.upsert({
      where: { id: site.id },
      update: {
        name: input.name,
        timezone: input.timezone,
        status: input.status,
      },
      create: {
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        code: input.code,
        timezone: input.timezone,
        status: input.status,
      },
    });

    return toDomainSite(row);
  }

  async findById(tenantId: TenantId, id: SiteId): Promise<Site | null> {
    const prisma = getPrismaClient();
    const row = await prisma.station.findFirst({ where: { id, tenantId } });
    return row ? toDomainSite(row) : null;
  }

  async list(tenantId: TenantId, query: SiteQuery = {}): Promise<ReadonlyArray<Site>> {
    const prisma = getPrismaClient();
    const rows = await prisma.station.findMany({
      where: {
        tenantId,
        ...(query.status ? { status: query.status as 'active' | 'inactive' } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: clampLimit(query.limit),
    });
    return rows.map(toDomainSite);
  }
}

// -------------------- Tanks --------------------

class PrismaTankRepository implements TankRepository {
  async save(tenantId: TenantId, tank: Tank): Promise<Tank> {
    assertOwnedByTenant(tenantId, tank, 'tanks.save');
    await ensureTenantExists(tenantId);
    const prisma = getPrismaClient();
    const input = toPrismaTankInput(tank);

    // Ensure station exists - if not, create a placeholder
    const station = await prisma.station.findFirst({
      where: { id: tank.siteId, tenantId },
    });
    if (!station) {
      await prisma.station.create({
        data: {
          id: tank.siteId,
          tenantId,
          name: `Station ${tank.siteId}`,
          code: tank.siteId,
          timezone: 'Africa/Dar_es_Salaam',
          status: 'active',
        },
      });
    }

    const row = await prisma.tank.upsert({
      where: { id: tank.id },
      update: {
        name: input.name,
        product: input.product,
        capacityLitres: input.capacityLitres,
        geometry: input.geometry,
        criticalLowPercent: input.criticalLowPercent,
        lowPercent: input.lowPercent,
        highPercent: input.highPercent,
        waterAlarmMm: input.waterAlarmMm,
        unexplainedDecreaseLitresPerHour: input.unexplainedDecreaseLitresPerHour,
        deliveryMinLitres: input.deliveryMinLitres,
        deliveryWindowMinutes: input.deliveryWindowMinutes,
        staleAfterMinutes: input.staleAfterMinutes,
        status: input.status,
      },
      create: {
        id: input.id,
        tenantId: input.tenantId,
        stationId: input.stationId,
        name: input.name,
        product: input.product,
        capacityLitres: input.capacityLitres,
        geometry: input.geometry,
        criticalLowPercent: input.criticalLowPercent,
        lowPercent: input.lowPercent,
        highPercent: input.highPercent,
        waterAlarmMm: input.waterAlarmMm,
        unexplainedDecreaseLitresPerHour: input.unexplainedDecreaseLitresPerHour,
        deliveryMinLitres: input.deliveryMinLitres,
        deliveryWindowMinutes: input.deliveryWindowMinutes,
        staleAfterMinutes: input.staleAfterMinutes,
        status: input.status,
      },
    });

    return toDomainTank(row);
  }

  async findById(tenantId: TenantId, id: TankId): Promise<Tank | null> {
    const prisma = getPrismaClient();
    const row = await prisma.tank.findFirst({ where: { id, tenantId } });
    return row ? toDomainTank(row) : null;
  }

  async list(tenantId: TenantId, query: TankQuery = {}): Promise<ReadonlyArray<Tank>> {
    const prisma = getPrismaClient();
    const rows = await prisma.tank.findMany({
      where: {
        tenantId,
        ...(query.siteId ? { stationId: query.siteId } : {}),
        ...(query.status ? { status: query.status as 'active' | 'decommissioned' } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: clampLimit(query.limit),
    });
    return rows.map(toDomainTank);
  }
}

// -------------------- Readings --------------------

class PrismaReadingRepository implements ReadingRepository {
  async append(tenantId: TenantId, reading: TankReading): Promise<TankReading> {
    assertOwnedByTenant(tenantId, reading, 'readings.append');
    await ensureTenantExists(tenantId);
    const prisma = getPrismaClient();
    const input = toPrismaReadingInput(reading);

    // Ensure tank exists? If not, let it fail - caller should create tank first
    const row = await prisma.tankReading.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        tankId: input.tankId,
        deviceId: input.deviceId,
        recordedAt: input.recordedAt,
        receivedAt: input.receivedAt,
        levelMm: input.levelMm,
        waterLevelMm: input.waterLevelMm,
        volumeLitres: input.volumeLitres,
        temperatureC: input.temperatureC,
        provenance: input.provenance,
        qualityStatus: input.qualityStatus,
        freshnessStatus: input.freshnessStatus,
        sourceProtocol: input.sourceProtocol,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return toDomainReading(row);
  }

  async findById(tenantId: TenantId, id: ReadingId): Promise<TankReading | null> {
    const prisma = getPrismaClient();
    const row = await prisma.tankReading.findFirst({ where: { id, tenantId } });
    return row ? toDomainReading(row) : null;
  }

  async findByIdempotencyKey(tenantId: TenantId, key: string): Promise<TankReading | null> {
    const prisma = getPrismaClient();
    const row = await prisma.tankReading.findFirst({
      where: { tenantId, idempotencyKey: key },
    });
    return row ? toDomainReading(row) : null;
  }

  async list(tenantId: TenantId, query: ReadingQuery): Promise<ReadonlyArray<TankReading>> {
    const prisma = getPrismaClient();
    const rows = await prisma.tankReading.findMany({
      where: {
        tenantId,
        tankId: query.tankId,
        ...(query.from ? { recordedAt: { gte: new Date(query.from) } } : {}),
        ...(query.to ? { recordedAt: { lte: new Date(query.to) } } : {}),
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: clampLimit(query.limit),
    });
    return rows.map(toDomainReading);
  }

  async latest(tenantId: TenantId, tankId: TankId): Promise<TankReading | null> {
    const prisma = getPrismaClient();
    const row = await prisma.tankReading.findFirst({
      where: { tenantId, tankId },
      orderBy: { recordedAt: 'desc' },
    });
    return row ? toDomainReading(row) : null;
  }
}

// -------------------- Alarms --------------------

class PrismaAlarmRepository implements AlarmRepository {
  async save(tenantId: TenantId, alarm: Alarm): Promise<Alarm> {
    assertOwnedByTenant(tenantId, alarm, 'alarms.save');
    await ensureTenantExists(tenantId);
    const prisma = getPrismaClient();
    const input = toPrismaAlertInput(alarm);

    const row = await prisma.alert.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        tankId: input.tankId,
        type: input.type,
        severity: input.severity,
        status: input.status,
        message: input.message,
        metrics: input.metrics,
        raisedAt: input.raisedAt,
      },
    });

    return toDomainAlarm(row);
  }

  async update(tenantId: TenantId, alarm: Alarm): Promise<Alarm> {
    assertOwnedByTenant(tenantId, alarm, 'alarms.update');
    const prisma = getPrismaClient();
    const input = toPrismaAlertInput(alarm);

    const row = await prisma.alert.update({
      where: { id: alarm.id },
      data: {
        type: input.type,
        severity: input.severity,
        status: input.status,
        message: input.message,
        metrics: input.metrics,
      },
    });

    // Ensure tenant ownership after update
    if (row.tenantId !== tenantId) {
      throw new Error('Tenant mismatch');
    }

    return toDomainAlarm(row);
  }

  async findById(tenantId: TenantId, id: AlarmId): Promise<Alarm | null> {
    const prisma = getPrismaClient();
    const row = await prisma.alert.findFirst({ where: { id, tenantId } });
    return row ? toDomainAlarm(row) : null;
  }

  async list(tenantId: TenantId, query: AlarmQuery = {}): Promise<ReadonlyArray<Alarm>> {
    const prisma = getPrismaClient();
    const rows = await prisma.alert.findMany({
      where: {
        tenantId,
        ...(query.tankId ? { tankId: query.tankId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ raisedAt: 'desc' }, { id: 'desc' }],
      take: clampLimit(query.limit),
    });
    return rows.map(toDomainAlarm);
  }

  async listOpenByTank(tenantId: TenantId, tankId: TankId): Promise<ReadonlyArray<Alarm>> {
    const prisma = getPrismaClient();
    const rows = await prisma.alert.findMany({
      where: {
        tenantId,
        tankId,
        status: { in: ['open', 'acknowledged'] },
      },
      orderBy: { raisedAt: 'asc' },
    });
    return rows.map(toDomainAlarm).filter(isOpenAlarm);
  }
}

export function createPrismaRepositories(): Repositories {
  return {
    sites: new PrismaSiteRepository(),
    tanks: new PrismaTankRepository(),
    readings: new PrismaReadingRepository(),
    alarms: new PrismaAlarmRepository(),
  };
}
