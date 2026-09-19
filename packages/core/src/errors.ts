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

export class ForbiddenError extends FuelTrackError {
  constructor(message = 'Access denied for this tenant') {
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
