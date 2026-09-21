import { describe, expect, it } from 'vitest';
import type { CredentialReadinessResult } from '@fueltrack/api';
import { ConfigurationError } from '../src/config.js';
import { enforceCredentialRequirement } from '../src/credential-gate.js';

function empty(hint: string | null): CredentialReadinessResult {
  return { status: { state: 'empty', usableCredentials: 0 }, hint };
}

describe('boot credential gate', () => {
  it('refuses to start with the remediation text when nothing is provisioned', () => {
    // The behavior that turns "every request says the API key is wrong" into a
    // single actionable startup failure.
    expect(() =>
      enforceCredentialRequirement(
        { requireCredentials: true },
        empty('Run npm run key:provision.'),
      ),
    ).toThrow(/Run npm run key:provision\./);
  });

  it('falls back to its own message when no hint is available', () => {
    expect(() => enforceCredentialRequirement({ requireCredentials: true }, empty(null))).toThrow(
      ConfigurationError,
    );
    expect(() => enforceCredentialRequirement({ requireCredentials: true }, empty(null))).toThrow(
      /No API key is provisioned/,
    );
  });

  it('starts when a usable credential exists', () => {
    const readiness: CredentialReadinessResult = {
      status: { state: 'ready', usableCredentials: 2 },
      hint: null,
    };
    expect(() =>
      enforceCredentialRequirement({ requireCredentials: true }, readiness),
    ).not.toThrow();
  });

  it('starts when credentials are not required', () => {
    expect(() =>
      enforceCredentialRequirement({ requireCredentials: false }, empty('hint')),
    ).not.toThrow();
  });

  it('starts when the store could not be read', () => {
    // A transient database outage must not stop a restart from coming up; the
    // health endpoint reports it instead.
    expect(() =>
      enforceCredentialRequirement(
        { requireCredentials: true },
        { status: { state: 'unavailable', usableCredentials: null, reason: 'Error' }, hint: null },
      ),
    ).not.toThrow();
  });
});
