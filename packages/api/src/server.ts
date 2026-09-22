import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  AlertSweepService,
  AuditService,
  createLogger,
  createStdioSink,
  createRateLimiter,
  enforceRateLimit,
  DashboardService,
  DeviceService,
  EventService,
  FleetService,
  IngestService,
  newId,
  ReportService,
  systemClock,
  type ApiKeyRegistry,
  type Clock,
  type CredentialStatusReader,
  type IngestService as IngestServiceType,
  type Logger,
  type LogLevel,
  type RateLimiter,
  type Repositories,
  type SchemaStatus,
} from '@fueltrack/core';
import { registerAuthentication } from './auth.js';
import { registerErrorHandler } from './errors.js';
import { registerStationRoutes } from './routes/stations.js';
import { registerTankRoutes } from './routes/tanks.js';
import { registerAlertRoutes } from './routes/alerts.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerEventRoutes } from './routes/events.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerAuditRoutes } from './routes/audit.js';

const DEFAULT_BODY_LIMIT_BYTES = 65_536;
/**
 * Upper bound for the `/healthz` readiness probe. A hung pooler connection
 * must not hang the health endpoint itself, otherwise load balancers and
 * operators cannot tell "API down" apart from "database down".
 */
const HEALTH_PROBE_TIMEOUT_MS = 3_000;

/**
 * Races a probe against a timeout and yields `onTimeout` instead of hanging or
 * throwing. The probe's rejection is intentionally swallowed after being
 * observed: detail belongs in platform logs, not HTTP responses.
 */
function withTimeout<T>(probe: () => Promise<T>, timeoutMs: number, onTimeout: T): Promise<T> {
  return new Promise<T>((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(onTimeout), timeoutMs);
    // A dangling health-probe timer must never keep a process or test alive.
    if (typeof timer.unref === 'function') timer.unref();
    void probe().then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      () => {
        clearTimeout(timer);
        resolvePromise(onTimeout);
      },
    );
  });
}

/**
 * Runs the schema probe under the same timeout as the readiness probe and
 * resolves `null` when it hangs or throws, so `/healthz` always answers.
 */
async function probeSchema(
  probe: (() => Promise<SchemaStatus>) | undefined,
  timeoutMs: number,
): Promise<SchemaStatus | null> {
  if (probe === undefined) {
    return null;
  }
  return withTimeout(probe, timeoutMs, null);
}

/**
 * One line, loggable description of a schema probe result. Table names only:
 * never a driver message, which can contain connection string fragments.
 */
function describeSchema(status: SchemaStatus | undefined): string {
  if (status === undefined) return 'not_configured';
  if (status.status === 'migrated') return 'migrated';
  if (status.status === 'unmigrated') return `missing:${status.missingTables.join(',')}`;
  return status.code === undefined ? status.reason : `${status.reason}:${status.code}`;
}

/**
 * Races the readiness probe against a timeout. Resolves `true` only when the
 * probe resolves in time, which is what `/healthz` turns into `up`/`down`.
 */
function probeWithTimeout(probe: () => Promise<void>, timeoutMs: number): Promise<boolean> {
  return withTimeout(
    async () => {
      await probe();
      return true;
    },
    timeoutMs,
    false,
  );
}

/**
 * `/healthz` credential labels. `not_configured` means the process was built
 * without a credential reader, which is the case for embedded and test servers.
 */
export type HealthCredentialsState = 'ready' | 'empty' | 'unavailable' | 'not_configured';

export interface ServerDependencies {
  readonly repositories: Repositories;
  readonly apiKeys: ApiKeyRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly fleetService?: FleetService;
  readonly ingestService?: IngestServiceType;
  readonly deviceService?: DeviceService;
  readonly eventService?: EventService;
  readonly dashboardService?: DashboardService;
  readonly reportService?: ReportService;
  readonly auditService?: AuditService;
  readonly alertSweepService?: AlertSweepService;
  /**
   * Secret used to salt the client-address hash written to the audit trail. No
   * secret means no address is stored at all, which is the safer default.
   */
  readonly auditHashSecret?: string;
  /**
   * Label of the persistence backend (`'prisma'`, `'memory'`, ...), reported
   * by `/healthz` so operators can verify which store a deployment is using.
   */
  readonly persistence?: string;
  /**
   * Optional readiness probe: resolves when the persistence backend answers,
   * rejects otherwise. `/healthz` returns 503 when the probe fails so a
   * broken database cannot hide behind a healthy-looking liveness response.
   */
  readonly ready?: () => Promise<void>;
  /**
   * Optional schema probe, consulted only after `ready` succeeds. Distinguishes
   * a reachable but never migrated database (`database: 'unmigrated'`) from a
   * healthy one, because both answer every authenticated request with the same
   * failure while needing opposite operator actions.
   */
  readonly schemaStatus?: () => Promise<SchemaStatus>;
  /**
   * Optional credential-store reader. When supplied it is used twice: a
   * rejected credential is explained as a provisioning fault when the store is
   * empty, and `/healthz` reports the store so a deployment that cannot
   * authenticate anybody is not mistaken for a healthy one.
   */
  readonly credentialStatus?: CredentialStatusReader;
}

export interface ServerOptions {
  readonly bodyLimitBytes?: number;
  /** Must stay enabled behind a reverse proxy so request.ip is meaningful. */
  readonly trustProxy?: boolean;
  readonly requestLogging?: boolean;
  readonly minLogLevel?: LogLevel;
  /**
   * Serves the read-only operator dashboard from a directory containing
   * index.html, dashboard.js and dashboard.css. Disabled unless supplied.
   */
  readonly dashboardDir?: string;
  /** Ingestion throttling. Enabled by default; pass `null` to disable. */
  readonly ingestionLimiter?: RateLimiter | null;
  /** General per-credential throttling. Enabled by default; `null` disables. */
  readonly apiLimiter?: RateLimiter | null;
  /** Failed-authentication throttling. Disabled unless supplied. */
  readonly authLimiter?: RateLimiter | null;
  /**
   * Interval in milliseconds for the in-process alert sweep. The sweep raises
   * stale-data and device-offline alerts for tanks that have stopped reporting,
   * which ingest can never do. `0` disables it.
   */
  readonly alertSweepIntervalMs?: number;
}

/**
 * Ten minutes. The sweep is cheap (it reads the recent window per active tank
 * and only writes when something changed), and it must be shorter than the
 * shortest stale-after threshold the platform allows a tank to configure.
 */
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60_000;
const DASHBOARD_FILES = new Set(['dashboard.js', 'dashboard.css']);
const DASHBOARD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'";
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * Builds an isolated Fastify instance. Called once per process and once per
 * test, so nothing here may touch global state or a real network.
 */
export async function buildServer(
  dependencies: ServerDependencies,
  options: ServerOptions = {},
): Promise<FastifyInstance> {
  const logger =
    dependencies.logger ??
    createLogger({
      sink: createStdioSink(),
      ...(options.minLogLevel === undefined ? {} : { minLevel: options.minLogLevel }),
    });
  const clock = dependencies.clock ?? systemClock;
  const fleet =
    dependencies.fleetService ??
    new FleetService({ repositories: dependencies.repositories, clock, logger });
  const ingest =
    dependencies.ingestService ??
    new IngestService({ repositories: dependencies.repositories, clock, logger });
  const devices =
    dependencies.deviceService ??
    new DeviceService({ repositories: dependencies.repositories, clock, logger });
  const events =
    dependencies.eventService ??
    new EventService({ repositories: dependencies.repositories, clock, logger });
  const dashboard =
    dependencies.dashboardService ??
    new DashboardService({
      repositories: dependencies.repositories,
      clock,
      logger,
      fleetService: fleet,
    });
  const reports =
    dependencies.reportService ??
    new ReportService({
      repositories: dependencies.repositories,
      clock,
      logger,
      fleetService: fleet,
      deviceService: devices,
      eventService: events,
    });
  const audit =
    dependencies.auditService ??
    new AuditService({ auditLogs: dependencies.repositories.auditLogs, clock, logger });
  const sweep =
    dependencies.alertSweepService ??
    new AlertSweepService({
      repositories: dependencies.repositories,
      clock,
      logger,
      ingestService: ingest,
    });

  const app = Fastify({
    logger: false,
    bodyLimit: options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    trustProxy: options.trustProxy ?? true,
    requestIdHeader: 'x-request-id',
    // Request logging is handled by the structured logger in onResponse, so
    // Fastify's own logger stays off.
    genReqId: () => newId('req'),
  });

  // CORS: must run before authentication so that preflight OPTIONS requests
  // with an Authorization header do not get rejected with 401 before the
  // browser sees the CORS headers. The frontend and device clients send
  // Authorization: Bearer <key>, which triggers a preflight.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin as string | undefined;
    if (origin !== undefined) {
      void reply.header('Access-Control-Allow-Origin', origin);
      void reply.header('Vary', 'Origin');
    } else {
      void reply.header('Access-Control-Allow-Origin', '*');
    }
    void reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    void reply.header(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Request-Id, Accept, Cache-Control',
    );
    void reply.header('Access-Control-Allow-Credentials', 'false');
    void reply.header('Access-Control-Max-Age', '86400');

    if (request.method === 'OPTIONS') {
      // Preflight never needs authentication; end the request here.
      return reply.code(204).send();
    }
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    void reply.header('X-Content-Type-Options', 'nosniff');
    void reply.header('X-Frame-Options', 'DENY');
    void reply.header('Referrer-Policy', 'no-referrer');
    void reply.header('Cache-Control', 'no-store');
    const servesHtml = String(reply.getHeader('content-type') ?? '').includes('text/html');
    void reply.header('Content-Security-Policy', servesHtml ? DASHBOARD_CSP : API_CSP);
    if (request.url.startsWith('/public/')) {
      void reply.header('Content-Security-Policy', DASHBOARD_CSP);
    }
    return payload;
  });

  if (options.requestLogging === true) {
    app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
      logger.info('http.request', {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        statusCode: reply.statusCode,
        tenantId: request.tenantContext?.tenantId ?? null,
      });
      done();
    });
  }

  registerErrorHandler(app, logger);

  app.get('/healthz', async (_request: FastifyRequest, reply: FastifyReply) => {
    const persistence = dependencies.persistence ?? 'memory';
    const time = clock.now().toISOString();

    const database: 'up' | 'down' | 'unmigrated' | 'not_configured' =
      dependencies.ready === undefined
        ? 'not_configured'
        : (await probeWithTimeout(dependencies.ready, HEALTH_PROBE_TIMEOUT_MS))
          ? 'up'
          : 'down';

    const credentials: HealthCredentialsState =
      dependencies.credentialStatus === undefined
        ? 'not_configured'
        : ((await withTimeout(dependencies.credentialStatus, HEALTH_PROBE_TIMEOUT_MS, null))
            ?.state ?? 'unavailable');

    if (database === 'down') {
      logger.warn('http.health_probe_failed', { persistence });
      return reply.code(503).send({ status: 'degraded', time, persistence, database, credentials });
    }

    const schema = await probeSchema(dependencies.schemaStatus, HEALTH_PROBE_TIMEOUT_MS);
    // Only a definite 'unmigrated' fails readiness. A probe that timed out
    // (null) or errored ('unknown') is inconclusive, and the readiness probe
    // already proved the database answers, so those must not report degraded.
    if (schema !== null && schema.status === 'unmigrated') {
      logger.warn('http.health_schema_unmigrated', {
        persistence,
        detail: describeSchema(schema),
      });
      return reply
        .code(503)
        .send({ status: 'degraded', time, persistence, database: 'unmigrated', credentials });
    }

    // `empty` and `unavailable` are degraded because neither can authenticate a
    // caller, and both used to look like a rejected API key from the outside. An
    // unprovisioned store is reported once at boot (`credentials.missing`), so
    // polling this endpoint does not repeat the warning; the body is the signal.
    if (credentials === 'empty' || credentials === 'unavailable') {
      return reply.code(503).send({ status: 'degraded', time, persistence, database, credentials });
    }

    return { status: 'ok', time, persistence, database, credentials };
  });

  const dashboardDir = options.dashboardDir;
  if (dashboardDir !== undefined) {
    app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const html = await readFile(join(dashboardDir, 'index.html'), 'utf8');
        return reply.type('text/html; charset=utf-8').send(html);
      } catch {
        return reply.code(404).send({ error: 'not_found', message: 'Dashboard is not available' });
      }
    });

    app.get('/public/:file', async (request: FastifyRequest, reply: FastifyReply) => {
      const requested = (request.params as { file?: string }).file ?? '';
      // Allow list only: prevents path traversal outside the dashboard folder.
      if (!DASHBOARD_FILES.has(requested)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const contentType = requested.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8';
      try {
        const contents = await readFile(join(dashboardDir, requested), 'utf8');
        return reply.type(contentType).send(contents);
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    });
  }

  await app.register(
    async (v1: FastifyInstance) => {
      registerAuthentication(v1, {
        apiKeys: dependencies.apiKeys,
        logger,
        touchLastUsed: true,
        ...(dependencies.credentialStatus === undefined
          ? {}
          : { credentialStatus: dependencies.credentialStatus }),
        ...(options.authLimiter === undefined || options.authLimiter === null
          ? {}
          : { authLimiter: options.authLimiter }),
      });

      // Registered after authentication so `tenantContext` is always set here.
      // A credential that has exhausted its budget is refused before any query
      // runs, which is the only way a rate limit actually protects the database.
      const apiLimiter =
        options.apiLimiter === null
          ? undefined
          : (options.apiLimiter ?? createRateLimiter({ limit: 600, windowSeconds: 60 }));
      if (apiLimiter !== undefined) {
        v1.addHook('onRequest', async (request: FastifyRequest) => {
          const identity = request.tenantContext?.apiKeyId ?? `ip:${request.ip}`;
          enforceRateLimit(apiLimiter, `api:${identity}`);
        });
      }
      const ingestionLimiter =
        options.ingestionLimiter === null
          ? undefined
          : (options.ingestionLimiter ?? createRateLimiter({ limit: 300, windowSeconds: 60 }));
      const shared = {
        audit,
        ...(dependencies.auditHashSecret === undefined
          ? {}
          : { ipHashSecret: dependencies.auditHashSecret }),
      };
      registerStationRoutes(v1, { fleet, ...shared });
      registerTankRoutes(v1, {
        fleet,
        ingest,
        dashboard,
        ...shared,
        ...(ingestionLimiter === undefined ? {} : { ingestionLimiter }),
      });
      registerAlertRoutes(v1, { fleet, sweep, ...shared });
      registerDeviceRoutes(v1, { devices, ...shared });
      registerEventRoutes(v1, { events, ...shared });
      registerDashboardRoutes(v1, { dashboard });
      registerReportRoutes(v1, { reports, ...shared });
      registerAuditRoutes(v1, { audit });
    },
    { prefix: '/v1' },
  );

  const sweepIntervalMs = options.alertSweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  if (sweepIntervalMs > 0) {
    const timer = setInterval(() => {
      void sweep
        .sweepAllTenants()
        .then((result) => {
          if (result.failingTanks > 0) {
            logger.warn('alert.sweep.partial', { failingTanks: result.failingTanks });
          }
        })
        .catch((error: unknown) => {
          logger.error('alert.sweep.failed', {
            reason: error instanceof Error ? error.name : 'unknown',
          });
        });
    }, sweepIntervalMs);
    // A background timer must never hold a process open, and it must stop when
    // the server closes so tests do not leak intervals.
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
    });
  }

  await app.ready();
  return app;
}
