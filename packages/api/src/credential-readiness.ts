import {
  inspectCredentialStore,
  createCachedCredentialStatus,
  type ApiKeyRegistry,
  type CredentialStatusReader,
  type CredentialStoreStatus,
  type Logger,
} from '@fueltrack/core';

/**
 * Boot-time credential readiness.
 *
 * FuelTrack serves every `/v1` route only to a caller holding a stored API key,
 * so a deployment with an empty credential store answers 401 to everybody while
 * `/healthz` reports `ok`. That is the state operators hit after a deploy where
 * `FUELTRACK_DEV_API_KEY` was set but `FUELTRACK_SEED_DEMO` was not, or where
 * the key was provisioned into a different environment, and it is
 * indistinguishable from a bad key except by reading this check.
 *
 * This module reports the state and logs it. Whether an empty store is fatal is
 * the entry point's decision: a long-lived server refuses to start, while a
 * serverless function stays reachable to report the fault through `/healthz`.
 */
export interface CredentialReadinessContext {
  /** `server` for a long-lived process, `serverless` for a function runtime. */
  readonly deployment: 'server' | 'serverless';
  /** Label of the active persistence backend (`prisma`, `memory`, ...). */
  readonly persistence: string;
  readonly demoSeedEnabled: boolean;
  /** True when the operator supplied FUELTRACK_DEV_API_KEY. */
  readonly devApiKeyConfigured: boolean;
}

export interface CredentialReadinessInput {
  readonly apiKeys: ApiKeyRegistry;
  readonly logger: Logger;
  readonly context: CredentialReadinessContext;
}

export interface CredentialReadinessResult {
  readonly status: CredentialStoreStatus;
  /** Actionable, secret-free remediation text. Null when the store is usable. */
  readonly hint: string | null;
}

/**
 * Remediation text. Deliberately names the environment variables and the exact
 * command, because the failure it explains is always a configuration mistake,
 * and it never contains key material.
 */
export function credentialProvisioningHint(context: CredentialReadinessContext): string {
  const steps = ['No usable API key is stored, so every authenticated request will be rejected.'];

  if (context.devApiKeyConfigured && !context.demoSeedEnabled) {
    steps.push(
      'FUELTRACK_DEV_API_KEY is set but FUELTRACK_SEED_DEMO is not true, so the key was never installed. Set FUELTRACK_SEED_DEMO=true, or provision a key with npm run key:provision.',
    );
  } else {
    steps.push(
      'Provision one with npm run key:provision (or set FUELTRACK_SEED_DEMO=true and FUELTRACK_DEV_API_KEY).',
    );
  }

  if (context.persistence === 'memory') {
    steps.push(
      'Persistence is in-memory, so keys are not shared between processes: set USE_PRISMA=true and DATABASE_URL to store credentials durably.',
    );
  }

  return steps.join(' ');
}

const EPHEMERAL_STORE_HINT =
  'A key stored in memory is not shared with other instances and is lost on every restart, so it can be accepted by one request and rejected by the next. Set USE_PRISMA=true and DATABASE_URL so credentials are stored durably.';

/**
 * Reads the credential store once at boot and logs the outcome at the level the
 * operator needs: an error while credentials are required, a warning otherwise.
 */
export async function checkCredentialReadiness(
  input: CredentialReadinessInput,
  options: { readonly requireCredentials: boolean },
): Promise<CredentialReadinessResult> {
  const status = await inspectCredentialStore(input.apiKeys);

  if (status.state === 'ready') {
    input.logger.info('credentials.ready', {
      usableCredentials: status.usableCredentials,
      persistence: input.context.persistence,
    });
    if (input.context.persistence === 'memory') {
      // The key that authenticates today is the one this process created. It is
      // reported as a warning rather than a failure because a single process
      // deployment does work, and it stops working the moment there is a second
      // instance or a restart.
      input.logger.warn('credentials.ephemeral_store', {
        persistence: input.context.persistence,
        usableCredentials: status.usableCredentials,
        hint: EPHEMERAL_STORE_HINT,
      });
    }
    return { status, hint: null };
  }

  if (status.state === 'empty') {
    const hint = credentialProvisioningHint(input.context);
    const context = {
      persistence: input.context.persistence,
      deployment: input.context.deployment,
      demoSeedEnabled: input.context.demoSeedEnabled,
      devApiKeyConfigured: input.context.devApiKeyConfigured,
      usableCredentials: 0,
    };
    if (options.requireCredentials) {
      input.logger.error('credentials.missing', { ...context, hint });
    } else {
      input.logger.warn('credentials.missing', { ...context, hint });
    }
    return { status, hint };
  }

  // The store could not be inspected. Reported, never fatal: an unreachable
  // database is already surfaced by the readiness probe, and failing the boot
  // on a transient outage would turn a recoverable blip into an outage.
  input.logger.error('credentials.unavailable', {
    persistence: input.context.persistence,
    reason: status.reason ?? 'unknown',
    ...(status.code === undefined ? {} : { code: status.code }),
    hint: 'The credential store could not be read. Check DATABASE_URL and that migrations have been applied.',
  });
  return { status, hint: null };
}

/**
 * Reader used by the running server: a short-lived cache in front of the same
 * inspection, so a rejected request can explain itself without letting an
 * unauthenticated caller generate one store query per request.
 */
export function createCredentialStatusReader(
  apiKeys: ApiKeyRegistry,
  options?: { readonly ttlMs?: number },
): CredentialStatusReader {
  return createCachedCredentialStatus(() => inspectCredentialStore(apiKeys), options ?? {});
}
