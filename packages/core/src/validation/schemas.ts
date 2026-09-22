import { z } from 'zod';
import { ValidationError } from '../errors.js';
import { isClientIdempotencyKey } from '../domain/idempotency.js';
import { DEFAULT_TANK_THRESHOLDS, FUEL_PRODUCTS } from '../domain/tank.js';
import { DEVICE_PROTOCOLS } from '../domain/device.js';
import { FUEL_EVENT_STATUSES, FUEL_EVENT_TYPES } from '../domain/event.js';
import { ALERT_TYPES } from '../domain/alert.js';
import {
  isIdentifier,
  type AlertId,
  type DeviceId,
  type FuelEventId,
  type StationId,
  type TankId,
  type TenantId,
} from '../types/ids.js';
import { isSimulatedScenario } from '../simulator/scenarios.js';

/**
 * Every value that originates outside the process (HTTP bodies, query strings,
 * device payloads, CLI arguments) is validated here before it reaches the
 * domain. Schemas are strict: unknown keys are rejected rather than ignored so
 * that a client cannot smuggle extra fields into a create or update.
 */

const identifier = (name: string) =>
  z
    .string()
    .min(2)
    .max(64)
    .refine(isIdentifier, {
      message: `${name} must be 2-64 lowercase alphanumeric characters or hyphens`,
    });

export const tenantIdSchema = identifier('tenantId').transform((value) => value as TenantId);
export const stationIdSchema = identifier('stationId').transform((value) => value as StationId);
export const tankIdSchema = identifier('tankId').transform((value) => value as TankId);
export const deviceIdSchema = identifier('deviceId').transform((value) => value as DeviceId);

const positiveFinite = z.number().finite().positive();
const nonNegativeFinite = z.number().finite().nonnegative();

const strappingPointSchema = z
  .object({
    levelMm: nonNegativeFinite,
    volumeLitres: nonNegativeFinite,
  })
  .strict();

/**
 * Geometry is parsed as a discriminated union, with strapping table
 * consistency checks applied afterwards so the union keeps a precise output
 * type. Dimensions are millimetres; strapping tables are supplied by the
 * vendor in litres and converted at the boundary.
 */
export const geometrySchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('vertical-cylinder'),
        diameterMm: positiveFinite,
        heightMm: positiveFinite,
      })
      .strict(),
    z
      .object({
        kind: z.literal('horizontal-cylinder'),
        diameterMm: positiveFinite,
        lengthMm: positiveFinite,
      })
      .strict(),
    z
      .object({
        kind: z.literal('strapping-table'),
        points: z.array(strappingPointSchema).min(2).max(500),
      })
      .strict(),
  ])
  .superRefine((geometry, ctx) => {
    if (geometry.kind !== 'strapping-table') {
      return;
    }
    const first = geometry.points[0];
    if (first !== undefined && first.levelMm !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The first strapping point must be at levelMm 0',
        path: ['points', 0, 'levelMm'],
      });
    }
    let previous = -1;
    geometry.points.forEach((point, index) => {
      if (point.levelMm <= previous) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Strapping points must be sorted by strictly increasing levelMm',
          path: ['points', index, 'levelMm'],
        });
      }
      previous = point.levelMm;
    });
  });

export const thresholdsSchema = z
  .object({
    criticalLowPercent: z.number().finite().min(0).max(100),
    lowPercent: z.number().finite().min(0).max(100),
    highPercent: z.number().finite().min(0).max(100),
    waterAlarmMm: nonNegativeFinite,
    rapidDropLitresPerHour: nonNegativeFinite,
    deliveryLitres: nonNegativeFinite,
    deliveryWindowMinutes: positiveFinite,
    staleAfterMinutes: positiveFinite,
  })
  .strict()
  .default(DEFAULT_TANK_THRESHOLDS)
  .superRefine((thresholds, ctx) => {
    if (thresholds.criticalLowPercent >= thresholds.lowPercent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'criticalLowPercent must be lower than lowPercent',
        path: ['criticalLowPercent'],
      });
    }
    if (thresholds.lowPercent >= thresholds.highPercent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lowPercent must be lower than highPercent',
        path: ['lowPercent'],
      });
    }
  });

const timezone = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/, 'timezone must be an IANA style zone name');

// -------------------- Stations --------------------

export const createStationSchema = z
  .object({
    id: stationIdSchema.optional(),
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/, 'code must be letters, digits or hyphens')
      .transform((value) => value.toUpperCase()),
    timezone: timezone.optional(),
  })
  .strict();

export const updateStationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: timezone.optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();

export const stationParamsSchema = z.object({ stationId: stationIdSchema }).strict();

export const listStationsQuerySchema = z
  .object({
    status: z.enum(['active', 'inactive']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

// -------------------- Tanks --------------------

export const createTankSchema = z
  .object({
    id: tankIdSchema.optional(),
    stationId: stationIdSchema,
    name: z.string().trim().min(1).max(120),
    product: z.enum(FUEL_PRODUCTS),
    geometry: geometrySchema,
    capacityLitres: positiveFinite.max(5_000_000),
    // Not wrapped in optional(): the schema carries a default, and wrapping a
    // defaulted schema in optional() would bypass the default.
    thresholds: thresholdsSchema,
    calibrationSource: z.string().trim().max(200).optional(),
    calibrationAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const updateTankSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    product: z.enum(FUEL_PRODUCTS).optional(),
    geometry: geometrySchema.optional(),
    capacityLitres: positiveFinite.max(5_000_000).optional(),
    thresholds: z
      .object({
        criticalLowPercent: z.number().finite().min(0).max(100),
        lowPercent: z.number().finite().min(0).max(100),
        highPercent: z.number().finite().min(0).max(100),
        waterAlarmMm: nonNegativeFinite,
        rapidDropLitresPerHour: nonNegativeFinite,
        deliveryLitres: nonNegativeFinite,
        deliveryWindowMinutes: positiveFinite,
        staleAfterMinutes: positiveFinite,
      })
      .strict()
      .optional(),
    status: z.enum(['active', 'decommissioned']).optional(),
    calibrationSource: z.string().trim().max(200).nullable().optional(),
    calibrationAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

// -------------------- Readings --------------------

const ingestReadingObjectSchema = z
  .object({
    tankId: tankIdSchema,
    observedAt: z.string().datetime({ offset: true }),
    levelMm: nonNegativeFinite.max(100_000),
    waterLevelMm: nonNegativeFinite.max(100_000),
    temperatureC: z.number().finite().min(-60).max(120).nullable().default(null),
    deviceId: deviceIdSchema.nullable().default(null),
    source: z.enum(['simulated', 'device', 'manual']).default('device'),
    signalQualityPercent: z.number().finite().min(0).max(100).optional(),
    // Client supplied submission identity. When omitted the platform derives
    // one from the sample, so a plain retry still collapses onto the original
    // reading instead of creating a duplicate dip.
    idempotencyKey: z
      .string()
      .trim()
      .refine(isClientIdempotencyKey, {
        message:
          'idempotencyKey must be 8-200 characters of letters, digits, dot, underscore, colon or hyphen',
      })
      .optional(),
  })
  .strict();

/**
 * Shared refinement so the body schema (which has no tankId) and the full
 * sample schema enforce exactly the same physical consistency rules.
 */
function checkWaterBelowProduct(
  reading: { levelMm: number; waterLevelMm: number },
  ctx: z.RefinementCtx,
): void {
  if (reading.waterLevelMm > reading.levelMm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'waterLevelMm cannot exceed levelMm',
      path: ['waterLevelMm'],
    });
  }
}

export const tankParamsSchema = z.object({ tankId: tankIdSchema }).strict();

export const ingestReadingSchema = ingestReadingObjectSchema.superRefine(checkWaterBelowProduct);

/** Body schema for `POST /v1/tanks/:tankId/readings`, where the tank comes from the path. */
export const ingestReadingBodySchema = ingestReadingObjectSchema
  .omit({ tankId: true })
  .superRefine(checkWaterBelowProduct);

const isoTimestamp = z.string().datetime({ offset: true });

export const listReadingsQuerySchema = z
  .object({
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    ascending: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be earlier than or equal to to',
        path: ['from'],
      });
    }
  });

export const listTanksQuerySchema = z
  .object({
    stationId: stationIdSchema.optional(),
    status: z.enum(['active', 'decommissioned']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

/** Tank as returned by the API, parsed by edge clients that must not trust it. */
export const tankSchema = z
  .object({
    id: tankIdSchema,
    tenantId: tenantIdSchema,
    stationId: stationIdSchema,
    name: z.string().min(1).max(120),
    product: z.enum(FUEL_PRODUCTS),
    geometry: geometrySchema,
    capacityLitres: positiveFinite,
    thresholds: thresholdsSchema,
    status: z.enum(['active', 'decommissioned']),
    calibrationSource: z.string().nullable(),
    calibrationAt: isoTimestamp.nullable(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .strict();

export const tankResponseSchema = z.object({ tank: tankSchema }).strict();

// -------------------- Alerts --------------------

export const alertParamsSchema = z
  .object({ alertId: identifier('alertId').transform((value) => value as AlertId) })
  .strict();

export const listAlertsQuerySchema = z
  .object({
    tankId: tankIdSchema.optional(),
    status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
    type: z.enum(ALERT_TYPES).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const updateAlertSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const assignAlertSchema = z
  .object({
    assignee: z.string().trim().min(1).max(120).nullable(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

// -------------------- Devices --------------------

export const deviceParamsSchema = z.object({ deviceId: deviceIdSchema }).strict();

export const registerDeviceSchema = z
  .object({
    id: deviceIdSchema.optional(),
    manufacturer: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(80),
    serialNumber: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9._:-]+$/, 'serialNumber must be letters, digits or . _ : -'),
    protocol: z.enum(DEVICE_PROTOCOLS),
    firmwareVersion: z.string().trim().max(40).nullable().optional(),
    credentialRef: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export const updateDeviceSchema = z
  .object({
    manufacturer: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(80).optional(),
    protocol: z.enum(DEVICE_PROTOCOLS).optional(),
    firmwareVersion: z.string().trim().max(40).nullable().optional(),
    status: z.enum(['registered', 'active', 'maintenance', 'retired']).optional(),
    credentialRef: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export const assignDeviceSchema = z.object({ tankId: tankIdSchema }).strict();

export const listDevicesQuerySchema = z
  .object({
    stationId: stationIdSchema.optional(),
    tankId: tankIdSchema.optional(),
    status: z.enum(['registered', 'active', 'maintenance', 'retired']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const rawMessagesQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
  .strict();

// -------------------- Events and deliveries --------------------

export const eventParamsSchema = z
  .object({ eventId: identifier('eventId').transform((value) => value as FuelEventId) })
  .strict();

export const listEventsQuerySchema = z
  .object({
    tankId: tankIdSchema.optional(),
    status: z.enum(FUEL_EVENT_STATUSES).optional(),
    type: z.enum(FUEL_EVENT_TYPES).optional(),
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be earlier than or equal to to',
        path: ['from'],
      });
    }
  });

export const confirmEventSchema = z
  .object({
    /** Volume stated by the supplier docket. Defaults to the measured rise. */
    recordedVolumeLitres: positiveFinite.max(1_000_000).optional(),
    reference: z.string().trim().max(120).optional(),
    supplier: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const rejectEventSchema = z
  .object({
    note: z.string().trim().min(3).max(500),
  })
  .strict();

export const listDeliveriesQuerySchema = z
  .object({
    tankId: tankIdSchema.optional(),
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

// -------------------- Dashboard, reports, audit --------------------

export const dashboardQuerySchema = z.object({ stationId: stationIdSchema.optional() }).strict();

export const tankSeriesQuerySchema = z
  .object({
    hours: z.coerce.number().int().min(1).max(720).default(24),
    buckets: z.coerce.number().int().min(4).max(200).default(48),
  })
  .strict();

export const reportParamsSchema = z
  .object({
    report: z.enum([
      'inventory',
      'stock-movement',
      'deliveries',
      'device-health',
      'alerts',
      'reconciliation',
    ]),
  })
  .strict();

export const reportQuerySchema = z
  .object({
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    stationId: stationIdSchema.optional(),
    tankId: tankIdSchema.optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be earlier than or equal to to',
        path: ['from'],
      });
    }
  });

export const auditQuerySchema = z
  .object({
    action: z.string().trim().max(80).optional(),
    resourceType: z.string().trim().max(80).optional(),
    from: isoTimestamp.optional(),
    to: isoTimestamp.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

// -------------------- API keys and simulator --------------------

export const API_KEY_SCOPES = [
  'readings:read',
  'readings:write',
  'tanks:read',
  'tanks:write',
  'stations:read',
  'stations:write',
  'alerts:read',
  'alerts:write',
  'events:read',
  'events:write',
  'devices:read',
  'devices:write',
  'deliveries:read',
  'reports:read',
  'dashboard:read',
  'audit:read',
  'raw:read',
  /** Required to submit readings tagged as simulated. */
  'simulator:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
  })
  .strict();

export const simulatorScenarioSchema = z
  .string()
  .refine(isSimulatedScenario, { message: 'unknown simulator scenario' });

// -------------------- Types --------------------

export type CreateStationInput = z.infer<typeof createStationSchema>;
export type UpdateStationInput = z.infer<typeof updateStationSchema>;
export type CreateTankInput = z.infer<typeof createTankSchema>;
export type UpdateTankInput = z.infer<typeof updateTankSchema>;
export type IngestReadingInput = z.infer<typeof ingestReadingSchema>;
export type ListReadingsQuery = z.infer<typeof listReadingsQuerySchema>;
export type ListTanksQuery = z.infer<typeof listTanksQuerySchema>;
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
export type AssignDeviceInput = z.infer<typeof assignDeviceSchema>;
export type ConfirmEventInput = z.infer<typeof confirmEventSchema>;
export type RejectEventInput = z.infer<typeof rejectEventSchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function formatIssues(error: z.ZodError): ReadonlyArray<ValidationIssue> {
  const issues: ValidationIssue[] = [];
  for (const issue of error.issues) {
    const base = issue.path.join('.');
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      // Zod reports unrecognised keys on the parent path; expand them so the
      // caller can see exactly which fields were rejected.
      for (const key of issue.keys) {
        issues.push({ path: base === '' ? key : `${base}.${key}`, message: issue.message });
      }
      continue;
    }
    issues.push({ path: base === '' ? '(root)' : base, message: issue.message });
  }
  return issues;
}

export function parseInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError('Request validation failed', formatIssues(result.error));
  }
  return result.data as z.infer<TSchema>;
}
