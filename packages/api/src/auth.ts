import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenError,
  runWithTenantContext,
  UnauthorizedError,
  type ApiKeyRegistry,
  type Logger,
  type TenantContext,
} from '@fueltrack/core';

const BEARER_PREFIX = 'Bearer ';
const MAX_SECRET_LENGTH = 256;

export interface AuthDependencies {
  readonly apiKeys: ApiKeyRegistry;
  readonly logger: Logger;
  /** Marks the last time a credential was used. Failures must not break auth. */
  readonly touchLastUsed?: boolean;
}

/**
 * The tenant of a request is derived exclusively from the presented API key.
 * Client supplied tenant headers are never trusted, because that would allow a
 * caller to choose which tenant's data to read.
 */
async function resolveTenantContext(
  request: FastifyRequest,
  dependencies: AuthDependencies,
): Promise<TenantContext> {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError('Missing bearer credentials');
  }

  const secret = header.slice(BEARER_PREFIX.length).trim();
  if (secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
    throw new UnauthorizedError('Malformed bearer credentials');
  }

  const record = await dependencies.apiKeys.findBySecret(secret);
  if (record === null) {
    dependencies.logger.warn('auth.failed', {
      requestId: request.id,
      remoteAddress: request.ip,
      userAgent:
        typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });
    throw new UnauthorizedError();
  }

  if (dependencies.touchLastUsed === true) {
    try {
      await dependencies.apiKeys.touchLastUsed(record.id, new Date().toISOString());
    } catch {
      // Usage bookkeeping is best effort and must never fail a request.
    }
  }

  return {
    tenantId: record.tenantId,
    principalId: `key:${record.id}` as TenantContext['principalId'],
    apiKeyId: record.id,
    scopes: record.scopes,
    ...(request.id === undefined ? {} : { requestId: request.id }),
  };
}

export function registerAuthentication(app: FastifyInstance, dependencies: AuthDependencies): void {
  app.decorateRequest('tenantContext', undefined);

  app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done) => {
    resolveTenantContext(request, dependencies)
      .then((context) => {
        request.tenantContext = context;
        // Continuing the lifecycle from inside the async context means every
        // downstream handler and repository call can use requireTenantContext().
        runWithTenantContext(context, () => done());
      })
      .catch((error: unknown) => {
        done(error instanceof Error ? error : new UnauthorizedError());
      });
  });
}

export function requireScopes(...required: ReadonlyArray<string>) {
  return async (request: FastifyRequest): Promise<void> => {
    const context = request.tenantContext;
    if (context === undefined) {
      throw new UnauthorizedError();
    }
    const granted = new Set(context.scopes);
    const missing = required.filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      throw new ForbiddenError('The credential does not grant the required scope');
    }
  };
}

export function currentTenantId(request: FastifyRequest) {
  const context = request.tenantContext;
  if (context === undefined) {
    throw new UnauthorizedError();
  }
  return context.tenantId;
}
