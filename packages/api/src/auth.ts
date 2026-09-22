import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CredentialsNotProvisionedError,
  enforceRateLimit,
  ForbiddenError,
  runWithTenantContext,
  UnauthorizedError,
  type ApiKeyRegistry,
  type CredentialStatusReader,
  type CredentialStoreStatus,
  type Logger,
  type RateLimiter,
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

/**
 * Why a credential was rejected. Recorded in logs only, never in the response:
 * the HTTP body stays identical for every rejection so a caller cannot tell a
 * wrong key from a revoked one. This is what makes an operator's report of
 * "API key rejected" diagnosable from the platform logs.
 */
export type AuthFailureReason =
  'missing_credentials' | 'malformed_credentials' | 'credential_not_found';

export interface AuthDependencies {
  readonly apiKeys: ApiKeyRegistry;
  readonly logger: Logger;
  /** Marks the last time a credential was used. Failures must not break auth. */
  readonly touchLastUsed?: boolean;
  /**
   * Reads the deployment credential health. When supplied, a rejected
   * credential is compared against the state of the store: an empty store is a
   * provisioning fault (503, "no API key provisioned") rather than a bad
   * credential (401, "valid API key credentials are required"). Optional so the
   * library stays usable in isolation, for example in unit tests of a route.
   */
  readonly credentialStatus?: CredentialStatusReader;
  /**
   * Throttles *rejected* credentials per client address. A key that is simply
   * wrong is cheap to answer but expensive to guess, and a device fleet with a
   * stale key can otherwise turn a misconfiguration into a flood of database
   * lookups. Successful requests are never limited here.
   */
  readonly authLimiter?: RateLimiter;
}

function requestContext(request: FastifyRequest): Record<string, unknown> {
  return {
    requestId: request.id,
    remoteAddress: request.ip,
    userAgent:
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

async function readCredentialStatus(
  dependencies: AuthDependencies,
): Promise<CredentialStoreStatus | null> {
  if (dependencies.credentialStatus === undefined) {
    return null;
  }
  try {
    return await dependencies.credentialStatus();
  } catch {
    // Diagnostics must never change the outcome of authentication.
    return null;
  }
}

/**
 * Rejects a presented but unresolvable credential.
 *
 * An empty store is reported as a deployment fault instead of a bad key. That
 * decision depends only on how many usable credentials exist, never on the
 * presented secret, so it leaks nothing to the caller: it says "this deployment
 * cannot authenticate anybody", not "this key is close".
 */
async function rejectPresentedCredential(
  request: FastifyRequest,
  dependencies: AuthDependencies,
  reason: AuthFailureReason,
): Promise<never> {
  const context = requestContext(request);
  if (dependencies.authLimiter !== undefined) {
    // Enforced before the store is inspected, so a guessing client cannot keep
    // forcing credential lookups.
    enforceRateLimit(dependencies.authLimiter, `auth:${request.ip}`);
  }
  const status = await readCredentialStatus(dependencies);

  if (status !== null && status.state === 'empty') {
    dependencies.logger.error('auth.rejected', {
      ...context,
      reason,
      usableCredentials: 0,
      hint: 'No API key is provisioned in this deployment. Set FUELTRACK_SEED_DEMO=true with FUELTRACK_DEV_API_KEY, or run npm run key:provision.',
    });
    throw new CredentialsNotProvisionedError();
  }

  dependencies.logger.warn('auth.rejected', {
    ...context,
    reason,
    ...(status?.usableCredentials === null || status?.usableCredentials === undefined
      ? {}
      : { usableCredentials: status.usableCredentials }),
  });
  throw new UnauthorizedError();
}

/**
 * The tenant of a request is derived exclusively from the presented API key.
 * Client supplied tenant headers are never trusted, because that would allow a
 * caller to choose which tenant's data to read.
 */
/**
 * A request that carried no bearer credential at all. Logged at debug because
 * it is either an unauthenticated probe or a proxy that stripped the header,
 * and because it cannot be caused by the state of the credential store.
 */
function rejectUnpresentedCredential(
  request: FastifyRequest,
  dependencies: AuthDependencies,
): never {
  dependencies.logger.debug('auth.rejected', {
    ...requestContext(request),
    reason: 'missing_credentials',
  });
  throw new UnauthorizedError('Missing bearer credentials');
}

async function resolveTenantContext(
  request: FastifyRequest,
  dependencies: AuthDependencies,
): Promise<TenantContext> {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return rejectUnpresentedCredential(request, dependencies);
  }

  const extracted = extractSecret(header);
  if (extracted === null) {
    // Present, but not a bearer credential: "Basic abc", a bare key without the
    // scheme, or a header rewritten by an intermediary.
    return rejectUnpresentedCredential(request, dependencies);
  }

  const secret = stripDuplicatedBearerPrefix(extracted);
  if (secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
    return rejectPresentedCredential(request, dependencies, 'malformed_credentials');
  }

  const record = await dependencies.apiKeys.findBySecret(secret);
  if (record === null) {
    return rejectPresentedCredential(request, dependencies, 'credential_not_found');
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
