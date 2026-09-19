import { z } from 'zod';
import { ValidationError } from '../errors.js';
import { FUEL_PRODUCTS } from '../domain/tank.js';
import { DEFAULT_TANK_THRESHOLDS } from '../domain/tank.js';
import {
  isIdentifier,
  type AlarmId,
  type SiteId,
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
export const siteIdSchema = identifier('siteId').transform((value) => value as SiteId);
export const tankIdSchema = identifier('tankId').transform((value) => value as TankId);

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
 * type.
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

export const createSiteSchema = z
  .object({
    id: siteIdSchema.optional(),
    name: z.string().trim().min(1).max(120),
    timezone: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/, 'timezone must be an IANA style zone name'),
  })
  .strict();

export const createTankSchema = z
  .object({
    id: tankIdSchema.optional(),
    siteId: siteIdSchema,
    name: z.string().trim().min(1).max(120),
    product: z.enum(FUEL_PRODUCTS),
    geometry: geometrySchema,
    capacityLitres: positiveFinite.max(5_000_000),
    // Not wrapped in optional(): the schema carries a default, and wrapping a
    // defaulted schema in optional() would bypass the default.
    thresholds: thresholdsSchema,
  })
  .strict();

const isoTimestamp = z.string().datetime({ offset: true });

const ingestReadingObjectSchema = z
  .object({
    tankId: tankIdSchema,
    observedAt: z.string().datetime({ offset: true }),
    levelMm: nonNegativeFinite.max(100_000),
    waterLevelMm: nonNegativeFinite.max(100_000),
    temperatureC: z.number().finite().min(-60).max(120).nullable().default(null),
    deviceId: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .refine(isIdentifier, {
        message: 'deviceId must be 2-64 lowercase alphanumeric characters or hyphens',
      })
      .nullable()
      .default(null),
    source: z.enum(['simulated', 'device', 'manual']).default('device'),
    signalQualityPercent: z.number().finite().min(0).max(100).optional(),
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

/**
 * Validates a tank as returned by the API. Edge devices and CLI tools must not
 * trust a geometry they did not produce, so the response is parsed too.
 */
export const tankSchema = z
  .object({
    id: tankIdSchema,
    tenantId: tenantIdSchema,
    siteId: siteIdSchema,
    name: z.string().min(1).max(120),
    product: z.enum(FUEL_PRODUCTS),
    geometry: geometrySchema,
    capacityLitres: positiveFinite,
    thresholds: thresholdsSchema,
    status: z.enum(['active', 'decommissioned']),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .strict();

export const tankResponseSchema = z.object({ tank: tankSchema }).strict();

export const ingestReadingSchema = ingestReadingObjectSchema.superRefine(checkWaterBelowProduct);

/** Body schema for `POST /v1/tanks/:tankId/readings`, where the tank comes from the path. */
export const ingestReadingBodySchema = ingestReadingObjectSchema
  .omit({ tankId: true })
  .superRefine(checkWaterBelowProduct);

export const tankParamsSchema = z.object({ tankId: tankIdSchema }).strict();
export const alarmParamsSchema = z
  .object({ alarmId: identifier('alarmId').transform((value) => value as AlarmId) })
  .strict();

export const listReadingsQuerySchema = z
  .object({
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

export const listTanksQuerySchema = z
  .object({
    siteId: siteIdSchema.optional(),
    status: z.enum(['active', 'decommissioned']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const listAlarmsQuerySchema = z
  .object({
    tankId: tankIdSchema.optional(),
    status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const acknowledgeAlarmSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const API_KEY_SCOPES = [
  'readings:read',
  'readings:write',
  'tanks:read',
  'tanks:write',
  'sites:read',
  'sites:write',
  'alarms:read',
  'alarms:write',
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

export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type CreateTankInput = z.infer<typeof createTankSchema>;
export type IngestReadingInput = z.infer<typeof ingestReadingSchema>;
export type ListReadingsQuery = z.infer<typeof listReadingsQuerySchema>;
export type ListTanksQuery = z.infer<typeof listTanksQuerySchema>;
export type ListAlarmsQuery = z.infer<typeof listAlarmsQuerySchema>;

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
