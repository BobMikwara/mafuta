import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ForbiddenError,
  runWithTenantContext,
  UnauthorizedError,
  type ApiKeyRegistry,
  type Logger,
  type TenantContext,
} from '@fueltrack/core';

const MAX_SECRET_LENGTH = 256;
// Accept "Bearer <token>" case-insensitively and tolerate extra whitespace.
// The secret itself never contains whitespace, so trimming is safe and matches
// the frontend's input.trim() behavior.
const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

function extractSecret(header: string): string | null {
  const trimmed = header.trim();
  // Fast path for the common correctly cased value, then regex fallback.
  if (trimmed.startsWith('Bearer ')) {
    return trimmed.slice('Bearer '.length).trim();
  }
  const match = BEARER_PATTERN.exec(trimmed);
  if (match?.[1] === undefined) {
    return null;
  }
  return match[1].trim();
}

// If the user pasted "Bearer ftk_..." into the UI, the frontend now strips it,
// but the backend also tolerates a duplicated prefix so that manual curl
// mistakes do not look like an invalid key.
function stripDuplicatedBearerPrefix(secret: string): string {
  let current = secret.trim();
  // Repeatedly strip so "Bearer Bearer ftk..." also works.
  while (/^Bearer\s+/i.test(current)) {
    current = current.replace(/^Bearer\s+/i, '').trim();
  }
  // Strip surrounding quotes that copy-paste from docs or JSON might introduce.
  if (
    (current.startsWith('"') && current.endsWith('"')) ||
    (current.startsWith("'") && current.endsWith("'"))
  ) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

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
  if (typeof header !== 'string') {
    throw new UnauthorizedError('Missing bearer credentials');
  }

  const extracted = extractSecret(header);
  if (extracted === null) {
    throw new UnauthorizedError('Missing bearer credentials');
  }

  const secret = stripDuplicatedBearerPrefix(extracted);
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
    // CORS preflight must not require credentials. The global CORS hook in
    // server.ts already replies 204, but when the frontend uses same-origin
    // fetch there is no preflight yet the browser may still issue OPTIONS.
    // Allowing OPTIONS through here keeps the behavior consistent if the
    // global hook is not present (e.g. in isolated tests).
    if (request.method === 'OPTIONS') {
      return done();
    }

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
