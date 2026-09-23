/**
 * Classifies and describes failed API requests for the console.
 *
 * Nothing here ever sees the API key: messages are built from the status code,
 * the server's non-secret error body, the request method and path, and the API
 * origin the console reached.
 */

/** JSON error body returned by the v1 API. Every field is optional on the wire. */
export interface ApiErrorBody {
  error?: string;
  message?: string;
  reason?: string;
  requiredScopes?: ReadonlyArray<string>;
  requestId?: string;
}

/**
 * Non-secret diagnostics for a failed request: method and URL path only. The
 * query string is omitted (it carries filters, not identity) and the
 * Authorization header is never part of any message.
 */
export interface RequestDiagnostics {
  readonly method: string;
  readonly path: string;
}

/**
 * What kind of failure this is, which decides how the console reacts:
 *
 * - `unauthorized` (401): the key is unknown, revoked or expired. Polling stops
 *   and the operator is asked for a key; retrying the same key cannot succeed.
 * - `forbidden` (403): the key is valid but lacks a permission. Only the
 *   affected panel shows the error; the rest of the dashboard keeps working.
 * - `unavailable` (503 provisioning fault): the server cannot accept any key.
 * - `network`: no HTTP response at all (offline, DNS, CORS).
 * - `other`: any other status, shown with the server's message.
 */
export type ApiErrorKind = 'unauthorized' | 'forbidden' | 'unavailable' | 'network' | 'other';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly reason: string | null;
  readonly requiredScopes: ReadonlyArray<string>;
  readonly requestId: string | null;

  constructor(options: {
    message: string;
    kind: ApiErrorKind;
    status: number | null;
    body?: ApiErrorBody;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.body?.error ?? null;
    this.reason = options.body?.reason ?? null;
    this.requiredScopes = options.body?.requiredScopes ?? [];
    this.requestId = options.body?.requestId ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Maps an HTTP status and body onto the reaction the console should take. */
export function classifyFailure(status: number, body: ApiErrorBody): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 503 && body.error === 'credentials_not_provisioned') return 'unavailable';
  return 'other';
}

function requestLine(status: number, diagnostics: RequestDiagnostics | undefined): string {
  const target = diagnostics === undefined ? '' : `${diagnostics.method} ${diagnostics.path} `;
  return `[${target}status ${status}]`;
}

function requestIdSuffix(body: ApiErrorBody): string {
  return body.requestId ? ` Request id: ${body.requestId}.` : '';
}

/**
 * Explanation for a 403. The server names the missing scope when the key lacks
 * one; older servers answered a bare `{"error":"forbidden"}`, which is still
 * explained as a permission problem rather than as a message-less rejection.
 */
function describeForbidden(body: ApiErrorBody): string {
  if (body.message) {
    return `Access denied. ${body.message}`;
  }
  const scopes = body.requiredScopes ?? [];
  if (scopes.length > 0) {
    return `Access denied. This API key is valid but does not grant ${scopes.join(', ')}.`;
  }
  return 'Access denied. This API key is valid but is not permitted to make this request. Ask an administrator for a key with the required scope.';
}

/**
 * Error text for one kind of server rejection. The key itself is never echoed,
 * and neither is any part of it.
 */
export function describeApiFailure(
  status: number,
  body: ApiErrorBody,
  apiTarget: string,
  diagnostics?: RequestDiagnostics,
): string {
  const line = requestLine(status, diagnostics);
  const kind = classifyFailure(status, body);
  if (kind === 'unavailable') {
    // The server is reachable and the key may well be correct: nothing is
    // provisioned on the server side, so blaming the pasted key would be wrong.
    return [
      'This deployment has no API key provisioned, so no key can be accepted yet.',
      'Provision one on the server (npm run key:provision) or start it with FUELTRACK_SEED_DEMO=true and FUELTRACK_DEV_API_KEY, then reconnect.',
      line,
      `API: ${apiTarget}`,
    ].join(' ');
  }
  if (kind === 'unauthorized') {
    const detail = body.message ? ` ${body.message}.` : '';
    return `API key rejected. The key is unknown, revoked or expired. Check the key and reconnect.${detail} ${line} API: ${apiTarget}`;
  }
  if (kind === 'forbidden') {
    return `${describeForbidden(body)}${requestIdSuffix(body)} ${line} API: ${apiTarget}`;
  }
  const explanation = body.message ?? `The API answered with status ${status}`;
  return `${explanation}${requestIdSuffix(body)} ${line} API: ${apiTarget}`;
}

/**
 * Reads an error body. Non-JSON bodies (proxy or platform pages) carry no
 * structured message, so a short single-line excerpt is kept for diagnostics;
 * long or empty bodies are dropped rather than dumped into the UI.
 */
export async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  const text = await res.text().catch(() => '');
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as ApiErrorBody) : {};
  } catch {
    const excerpt = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    return excerpt.length > 0 ? { message: excerpt } : {};
  }
}
