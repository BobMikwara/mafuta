import { TooManyRequestsError } from '../errors.js';

/**
 * Rate limiting for ingestion and authentication (TRD section 7).
 *
 * The limiter is a fixed window counter rather than a token bucket: it is
 * trivial to reason about, cheap, and its worst case (a burst across a window
 * boundary) is irrelevant for these endpoints. The interface exists so a
 * deployment with several instances can swap in a shared store (Redis) without
 * changing a single call site.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Counts one attempt for `key` and reports whether it is allowed. */
  check(key: string, now?: Date): RateLimitDecision;
}

export interface RateLimitOptions {
  readonly limit: number;
  readonly windowSeconds: number;
}

interface WindowState {
  windowStartMs: number;
  count: number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const windowMs = Math.max(1, options.windowSeconds) * 1000;
  const limit = Math.max(1, options.limit);
  const windows = new Map<string, WindowState>();

  return {
    check(key: string, now: Date = new Date()): RateLimitDecision {
      const nowMs = now.getTime();
      const existing = windows.get(key);
      if (existing === undefined || nowMs - existing.windowStartMs >= windowMs) {
        windows.set(key, { windowStartMs: nowMs, count: 1 });
        return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }
      if (existing.count >= limit) {
        const resetInMs = windowMs - (nowMs - existing.windowStartMs);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(resetInMs / 1000)),
        };
      }
      existing.count += 1;
      return {
        allowed: true,
        remaining: Math.max(0, limit - existing.count),
        retryAfterSeconds: 0,
      };
    },
  };
}

/** Limits applied to a request before the handler runs. */
export interface RateLimitPolicy {
  /** Requests allowed per credential per window. */
  readonly perCredential: RateLimitOptions;
  /** Failed authentications allowed per client address per window. */
  readonly perClientAddress: RateLimitOptions;
  /** Ingestion requests allowed per credential per window. */
  readonly ingestion: RateLimitOptions;
}

/**
 * Documented defaults. They are deliberately generous: a pilot station with
 * five probes polling once a minute produces under ten readings a minute, so
 * the ingestion limit is a safety valve against a runaway device, not a
 * throttle on normal traffic.
 */
export const DEFAULT_RATE_LIMITS: RateLimitPolicy = {
  perCredential: { limit: 600, windowSeconds: 60 },
  perClientAddress: { limit: 30, windowSeconds: 60 },
  ingestion: { limit: 300, windowSeconds: 60 },
};

/** Reads a positive integer from the environment, falling back when unset. */
export function rateLimitFromEnv(
  raw: string | undefined,
  fallback: RateLimitOptions,
): RateLimitOptions {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return { ...fallback, limit: parsed };
}

export function enforceRateLimit(limiter: RateLimiter, key: string, now?: Date): void {
  const decision = limiter.check(key, now);
  if (!decision.allowed) {
    throw new TooManyRequestsError(
      `Rate limit exceeded. Retry in ${decision.retryAfterSeconds} seconds`,
      decision.retryAfterSeconds,
    );
  }
}
