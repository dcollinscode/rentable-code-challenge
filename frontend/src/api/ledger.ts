import { LedgerResponse } from '../types';

/**
 * Typed error thrown for any non-2xx response from the ledger endpoint.
 * Carries the HTTP status and, when the backend provides one, a machine
 * readable `detail` message (DRF returns `{"detail": "..."}` for 4xx/5xx).
 */
export class LedgerApiError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `Request failed with status ${status}`);
    this.name = 'LedgerApiError';
    this.status = status;
    this.detail = detail;
  }
}

export interface GetLedgerOptions {
  /** Abort signal so callers can cancel in-flight requests. */
  signal?: AbortSignal;
}

/**
 * Fetch a tenant's ledger.
 *
 * GET /api/tenants/<tenantId>/ledger/
 *
 * Throws `LedgerApiError` on any non-2xx response, and re-throws
 * `AbortError` untouched so callers can ignore cancellations.
 */
export async function getLedger(
  tenantId: number,
  options: GetLedgerOptions = {}
): Promise<LedgerResponse> {
  const response = await fetch(`/api/tenants/${tenantId}/ledger/`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    // Send cookies for session-authenticated APIs. Tighten to 'same-origin'
    // if the API is served from the same origin and you don't want
    // third-party cookies.
    credentials: 'same-origin',
    signal: options.signal,
  });

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.json();
      if (body && typeof body.detail === 'string') {
        detail = body.detail;
      }
    } catch {
      // Non-JSON error body (e.g. an HTML 500 page) — fall back to status.
    }
    throw new LedgerApiError(response.status, detail);
  }

  // Guard against 200/204 responses with an empty body. A truly empty
  // ledger response would be a server bug, but we should surface it as a
  // typed error rather than a raw SyntaxError from `response.json()`.
  const text = await response.text();
  if (!text) {
    throw new LedgerApiError(response.status, 'Empty response body');
  }

  try {
    return JSON.parse(text) as LedgerResponse;
  } catch {
    throw new LedgerApiError(response.status, 'Malformed JSON in response');
  }
}