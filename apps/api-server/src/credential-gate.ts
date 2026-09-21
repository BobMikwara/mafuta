import type { CredentialReadinessResult } from '@fueltrack/api';
import { ConfigurationError } from './config.js';

/**
 * Boot decision for a long-lived server.
 *
 * A server that cannot authenticate anybody is not a healthy server: it answers
 * 401 `Valid API key credentials are required` to every caller, which reads as
 * "the key you pasted is wrong". Refusing to start, with the remediation text
 * produced by the readiness check, is what turns that into an actionable
 * deployment error. Set FUELTRACK_REQUIRE_CREDENTIALS=false to opt out.
 *
 * `unavailable` is deliberately not fatal: the store could not be read, which
 * is already reported by `/healthz` as degraded, and a transient database blip
 * must not stop a restart from coming up.
 */
export function enforceCredentialRequirement(
  options: { readonly requireCredentials: boolean },
  readiness: CredentialReadinessResult,
): void {
  if (!options.requireCredentials || readiness.status.state !== 'empty') {
    return;
  }
  throw new ConfigurationError(
    readiness.hint ??
      'No API key is provisioned in this deployment, so no request can be authenticated',
  );
}
