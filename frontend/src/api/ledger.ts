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

/**
 * Fetch a tenant's ledger.
 *
 * GET /api/tenants/<tenantId>/ledger/
 *
 * Throws `LedgerApiError` on any non-2xx response.
 */
export async function getLedger(tenantId: number): Promise<LedgerResponse> {
  const response = await fetch(`/api/tenants/${tenantId}/ledger/`, {
    headers: { Accept: 'application/json' },
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

  return (await response.json()) as LedgerResponse;
}
