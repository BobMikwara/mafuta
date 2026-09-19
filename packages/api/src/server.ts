import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  createLogger,
  createStdioSink,
  FleetService,
  IngestService,
  newId,
  systemClock,
  type ApiKeyRegistry,
  type Clock,
  type IngestService as IngestServiceType,
  type Logger,
  type LogLevel,
  type Repositories,
} from '@fueltrack/core';
import { registerAuthentication } from './auth.js';
import { registerErrorHandler } from './errors.js';
import { registerSiteRoutes } from './routes/sites.js';
import { registerTankRoutes } from './routes/tanks.js';
import { registerAlarmRoutes } from './routes/alarms.js';

const DEFAULT_BODY_LIMIT_BYTES = 65_536;

export interface ServerDependencies {
  readonly repositories: Repositories;
  readonly apiKeys: ApiKeyRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly fleetService?: FleetService;
  readonly ingestService?: IngestServiceType;
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
}

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

  const app = Fastify({
    logger: false,
    bodyLimit: options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    trustProxy: options.trustProxy ?? true,
    requestIdHeader: 'x-request-id',
    // Request logging is handled by the structured logger in onResponse, so
    // Fastify's own logger stays off.
    genReqId: () => newId('req'),
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

  app.get('/healthz', async () => ({
    status: 'ok',
    time: clock.now().toISOString(),
  }));

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
      registerAuthentication(v1, { apiKeys: dependencies.apiKeys, logger, touchLastUsed: true });
      registerSiteRoutes(v1, { fleet });
      registerTankRoutes(v1, { fleet, ingest });
      registerAlarmRoutes(v1, { fleet });
    },
    { prefix: '/v1' },
  );

  await app.ready();
  return app;
}
