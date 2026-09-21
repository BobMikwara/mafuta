import type { ApiKeyRegistry } from './api-key.js';

/**
 * Deployment-level health of the API key store.
 *
 * The distinction that matters in production is between "this key is wrong" and
 * "this deployment has no key at all". Before this module existed both looked
 * identical to a caller (401 `Valid API key credentials are required`) and to
 * the logs, which is why a correct key could be chased for hours while the real
 * fault was that nothing had ever provisioned a credential, or that the
 * credential lived in another process's memory.
 */
export type CredentialStoreState = 'ready' | 'empty' | 'unavailable';

export interface CredentialStoreStatus {
  readonly state: CredentialStoreState;
  /** Usable credentials found. Null when the store could not be inspected. */
  readonly usableCredentials: number | null;
  /**
   * Error class name only. Prisma initialization errors embed connection
   * string fragments in their message, so the message is never captured here.
   */
  readonly reason?: string;
  /** Driver code such as `P2021`, which is what makes an unmigrated database visible. */
  readonly code?: string;
}

export type CredentialStatusReader = () => Promise<CredentialStoreStatus>;

/**
 * Non-secret failure signature: the error name plus a string `code` when the
 * driver provides one. Mirrors the redaction policy of the HTTP error handler.
 */
function errorSignature(error: unknown): { reason: string; code?: string } {
  const reason = error instanceof Error ? error.name : 'UnknownError';
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return { reason, code: (error as { code: string }).code };
  }
  return { reason };
}

/**
 * Inspects the credential store. Never throws: an unreachable store is reported
 * as `unavailable` so the caller can decide whether that is fatal (it is not,
 * because the persistence probe already reports an unreachable database).
 */
export async function inspectCredentialStore(
  apiKeys: ApiKeyRegistry,
): Promise<CredentialStoreStatus> {
  try {
    const usableCredentials = await apiKeys.countUsable();
    if (usableCredentials > 0) {
      return { state: 'ready', usableCredentials };
    }
    return { state: 'empty', usableCredentials: 0 };
  } catch (error: unknown) {
    return { state: 'unavailable', usableCredentials: null, ...errorSignature(error) };
  }
}

export interface CachedCredentialStatusOptions {
  /** How long a result is reused. Defaults to 5 seconds. */
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/**
 * Wraps a status reader with a short time to live.
 *
 * Authentication consults the store on the rejection path to tell a bad key
 * apart from a missing deployment key. Without the cache, an unauthenticated
 * caller could turn every rejected request into an extra counting query, so the
 * answer is reused for a few seconds at a time. A short window is safe in the
 * other direction too: it only delays noticing a newly provisioned key, and the
 * key itself is still verified against the store on every request.
 */
export function createCachedCredentialStatus(
  reader: CredentialStatusReader,
  options: CachedCredentialStatusOptions = {},
): CredentialStatusReader {
  const ttlMs = options.ttlMs ?? 5_000;
  const now = options.now ?? (() => Date.now());
  let cached: { readonly at: number; readonly status: CredentialStoreStatus } | null = null;
  let inFlight: Promise<CredentialStoreStatus> | null = null;

  return async (): Promise<CredentialStoreStatus> => {
    const current = now();
    if (cached !== null && current - cached.at < ttlMs) {
      return cached.status;
    }
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = reader()
      .then((status) => {
        cached = { at: now(), status };
        return status;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
