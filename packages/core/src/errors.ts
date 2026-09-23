/**
 * Error taxonomy. Errors that reach an HTTP caller are mapped to status codes
 * in the API package; internal messages must never leak credentials or
 * cross-tenant data.
 */
export class FuelTrackError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidIdentifierError extends FuelTrackError {
  constructor(public readonly identifierName: string) {
    super(
      `Invalid identifier for ${identifierName}: expected 2-64 lowercase alphanumeric characters or hyphens.`,
    );
  }
}

export class ValidationError extends FuelTrackError {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export class NotFoundError extends FuelTrackError {
  constructor(
    public readonly resource: string,
    public readonly resourceId: string,
  ) {
    super(`${resource} not found`);
  }
}

export class UnauthorizedError extends FuelTrackError {
  constructor(message = 'Missing or invalid credentials') {
    super(message);
  }
}

/**
 * Raised when a deployment cannot authenticate anyone because its credential
 * store is reachable but holds no usable API key. This is a provisioning fault,
 * not a bad credential, so it must not be reported as `unauthorized`: operators
 * spent hours re-checking a correct key that simply was never installed.
 *
 * It is not a credential oracle either. The condition depends only on the state
 * of the store, never on the secret that was presented.
 */
export class CredentialsNotProvisionedError extends FuelTrackError {
  constructor(message = 'This deployment has no API key provisioned') {
    super(message);
  }
}

export class ForbiddenError extends FuelTrackError {
  constructor(message = 'Access denied for this tenant') {
    super(message);
  }
}

/**
 * An authenticated credential that lacks a scope the operation requires. The
 * key is valid and the tenant is resolved; the caller simply is not permitted
 * to perform this operation. Carries the missing scope names, which are part of
 * the public API contract (not secrets), so the HTTP layer can tell the caller
 * exactly which permission to request instead of answering a bare 403.
 */
export class InsufficientScopeError extends ForbiddenError {
  constructor(public readonly requiredScopes: ReadonlyArray<string>) {
    super(
      `This API key does not grant the ${requiredScopes.join(', ')} scope${
        requiredScopes.length === 1 ? '' : 's'
      } required for this request. Ask an administrator for a key that includes ${
        requiredScopes.length === 1 ? 'it' : 'them'
      }.`,
    );
  }
}

/**
 * Raised when a caller exceeds a configured rate limit. The retry delay is part
 * of the error so the HTTP layer can answer 429 with a `Retry-After` header
 * instead of leaving a device to guess when it may try again.
 */
export class TooManyRequestsError extends FuelTrackError {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

export class ConflictError extends FuelTrackError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Raised when a code path attempts to read, write or return data belonging to
 * a tenant other than the one bound to the current operation. This is always
 * treated as a security incident: it is logged at critical level and never
 * surfaced to the caller with tenant-specific detail.
 */
export class TenantIsolationError extends FuelTrackError {
  constructor(
    public readonly expectedTenantId: string,
    public readonly actualTenantId: string,
    public readonly operation: string,
  ) {
    super('Tenant isolation violation detected');
  }
}
