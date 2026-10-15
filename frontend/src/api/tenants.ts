import { Paginated, Tenant } from '../types';

/**
 * The backend returns *relative* pagination links (e.g. "/api/tenants/?page=2"),
 * so the client simply follows the `next`/`previous` values it receives — no
 * URL rewriting is needed. The relative form keeps requests same-origin: in dev
 * they go through the CRA proxy to the backend, and in production the SPA and
 * API share an origin.
 */

/**
 * Typed error thrown for any non-2xx response from the tenants endpoint.
 * Carries the HTTP status and, when the backend provides one, a machine
 * readable `detail` message (DRF returns `{"detail": "..."}` for 4xx/5xx).
 */
export class TenantsApiError extends Error {
  readonly status: number;
  readonly detail: string | null;

  constructor(status: number, detail: string | null) {
    super(detail ?? `Request failed with status ${status}`);
    this.name = 'TenantsApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Fetch one page of tenants from an explicit URL.
 *
 * Prefer this over `getTenants(page)` in the UI: the pagination envelope hands
 * out `next`/`previous` links, so following them directly means the frontend
 * never has to reconstruct query strings (and can't drift from whatever the
 * server considers the canonical page URL — page size, filters, ordering, etc.).
 *
 * Throws `TenantsApiError` on any non-2xx response.
 */
export async function getTenantsByUrl(url: string): Promise<Paginated<Tenant>> {
  const response = await fetch(url, {
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
    throw new TenantsApiError(response.status, detail);
  }

  return (await response.json()) as Paginated<Tenant>;
}

/**
 * Convenience wrapper for callers that only know the page number.
 *
 * GET /api/tenants/?page=<page>
 *
 * When no page is given it fetches the first page from the bare endpoint, so
 * the server's configured default page size applies. The UI should normally
 * use `getTenantsByUrl` with the `next`/`previous` links instead.
 */
export function getTenants(page?: number): Promise<Paginated<Tenant>> {
  const url = page && page > 1 ? `/api/tenants/?page=${page}` : '/api/tenants/';
  return getTenantsByUrl(url);
}

