import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ConflictError,
  ForbiddenError,
  formatIssues,
  NotFoundError,
  TenantIsolationError,
  UnauthorizedError,
  ValidationError,
  type Logger,
} from '@fueltrack/core';
import { ZodError } from 'zod';

interface ErrorBody {
  error: string;
  message?: string | undefined;
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

      if (error instanceof ForbiddenError) {
        const body: ErrorBody = {
          error: 'forbidden',
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
