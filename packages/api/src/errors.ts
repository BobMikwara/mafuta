import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ConflictError,
  CredentialsNotProvisionedError,
  ForbiddenError,
  formatIssues,
  InsufficientScopeError,
  NotFoundError,
  TenantIsolationError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
  type Logger,
} from '@fueltrack/core';
import { ZodError } from 'zod';

interface ErrorBody {
  error: string;
  message?: string | undefined;
  /** Machine readable refinement of `error`, for example `insufficient_scope`. */
  reason?: string | undefined;
  /** Scope names a 403 is missing. Public API vocabulary, never secret. */
  requiredScopes?: ReadonlyArray<string> | undefined;
  issues?: ReadonlyArray<{ path: string; message: string }> | undefined;
  requestId?: string | undefined;
}

function isFastifyError(error: unknown): error is FastifyError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * Maps domain errors onto HTTP responses. Internal error detail is never
 * returned to the caller; it is logged with a request id that can be
 * correlated with the platform logs.
 */
export function registerErrorHandler(app: FastifyInstance, logger: Logger): void {
  app.setErrorHandler(
    (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = typeof request.id === 'string' ? request.id : undefined;

      if (error instanceof TenantIsolationError) {
        logger.critical('tenant.isolation.violation', { requestId, operation: error.operation });
        const body: ErrorBody = { error: 'internal_error', requestId };
        return reply.code(500).send(body);
      }

      if (error instanceof ValidationError) {
        const body: ErrorBody = {
          error: 'validation_failed',
          message: 'Request validation failed',
          issues: error.issues,
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(400).send(body);
      }

      if (error instanceof ZodError) {
        const body: ErrorBody = {
          error: 'validation_failed',
          message: 'Request validation failed',
          issues: formatIssues(error),
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(400).send(body);
      }

      if (error instanceof UnauthorizedError) {
        void reply.header('WWW-Authenticate', 'Bearer realm="fueltrack"');
        const body: ErrorBody = {
          error: 'unauthorized',
          message: 'Valid API key credentials are required',
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(401).send(body);
      }

      if (error instanceof CredentialsNotProvisionedError) {
        // A deployment fault, not a bad credential: the store holds no usable
        // key, so no key the operator can paste would be accepted. Reported as
        // 503 so a UI or probe can tell the two apart. The body carries no
        // secret and no store internals, and it is independent of the presented
        // credential, so it is not a credential oracle.
        void reply.header('WWW-Authenticate', 'Bearer realm="fueltrack"');
        const body: ErrorBody = {
          error: 'credentials_not_provisioned',
          message: 'This deployment has no API key provisioned',
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(503).send(body);
      }

      if (error instanceof TooManyRequestsError) {
        void reply.header('Retry-After', String(error.retryAfterSeconds));
        const body: ErrorBody = {
          error: 'rate_limited',
          message: error.message,
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(429).send(body);
      }

      if (error instanceof InsufficientScopeError) {
        // Authenticated, tenant resolved, but the key lacks a permission. The
        // body says which scope is missing (RFC 6750 `insufficient_scope`), so
        // an operator is not left with an unexplained 403. Scope names are the
        // public API vocabulary; nothing about the key or the tenant is echoed.
        void reply.header(
          'WWW-Authenticate',
          `Bearer realm="fueltrack", error="insufficient_scope", scope="${error.requiredScopes.join(' ')}"`,
        );
        logger.warn('auth.forbidden', {
          requestId,
          method: request.method,
          route: request.routeOptions.url ?? request.url,
          reason: 'insufficient_scope',
          requiredScopes: error.requiredScopes,
          keyId: request.tenantContext?.apiKeyId ?? null,
        });
        const body: ErrorBody = {
          error: 'forbidden',
          reason: 'insufficient_scope',
          message: error.message,
          requiredScopes: error.requiredScopes,
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(403).send(body);
      }

      if (error instanceof ForbiddenError) {
        // Every ForbiddenError message is a fixed, non-secret sentence written
        // for the caller ("Device is not assigned to this tank"), so it is
        // returned rather than leaving the client to guess why it was refused.
        const body: ErrorBody = {
          error: 'forbidden',
          message: error.message,
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(403).send(body);
      }

      if (error instanceof NotFoundError) {
        const body: ErrorBody = {
          error: 'not_found',
          message: error.message,
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(404).send(body);
      }

      if (error instanceof ConflictError) {
        const body: ErrorBody = {
          error: 'conflict',
          message: error.message,
          ...(requestId === undefined ? {} : { requestId }),
        };
        return reply.code(409).send(body);
      }

      if (isFastifyError(error) && error.code === 'FST_ERR_VALIDATION') {
        const body: ErrorBody = { error: 'validation_failed', message: error.message };
        return reply.code(400).send(body);
      }

      if (isFastifyError(error) && error.statusCode !== undefined && error.statusCode < 500) {
        const body: ErrorBody = { error: 'request_rejected', message: error.message };
        return reply.code(error.statusCode).send(body);
      }

      logger.error('http.unhandled_error', {
        requestId,
        method: request.method,
        url: request.url,
        reason: error.name,
        // Prisma and the driver tag failures (`P1001` unreachable database,
        // `P2021` missing table, ...). Surfacing the code here is what lets an
        // operator correlate a bare `internal_error` response with the actual
        // cause in the platform logs. Logged only - never sent to the caller.
        ...('code' in error && typeof (error as { code?: unknown }).code === 'string'
          ? { code: (error as { code: string }).code }
          : {}),
      });

      const body: ErrorBody = { error: 'internal_error', requestId };
      return reply.code(500).send(body);
    },
  );

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const body: ErrorBody = {
      error: 'not_found',
      message: 'No route matches this request',
      ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
    };
    return reply.code(404).send(body);
  });
}
