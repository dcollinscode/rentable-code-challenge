/**
 * Types mirroring the Django REST Framework serializers in
 * `backend/api/serializers.py`. If the API shape changes, these are the single
 * source of truth on the client and the compiler will flag any drift.
 */

/**
 * Mirrors `TenantSerializer` (fields = '__all__' on the Tenant model).
 * Used by `GET /api/tenants/`.
 */
export interface Tenant {
  id: number;
  name: string;
  unit: string | null;
  pms_tenant_id: number | null;
}

/**
 * Mirrors `LedgerTransactionSerializer` in the ledger payload.
 * Note: `date` is a DRF DateField serialized as "YYYY-MM-DD".
 * `amount` is a DRF DecimalField serialized as a *string* (coerce_to_string).
 * `type` is a nullable CharField ("charge" | "payment" | ...).
 */
export interface Transaction {
  id: number;
  external_id: number;
  date: string;
  description: string;
  amount: string;
  type: string | null;
}

/**
 * Mirrors `LedgerTenantSerializer`: `tenant_id` is the tenant's id in the
 * external PMS (`pms_tenant_id`), distinct from the local Django `id`.
 */
export interface LedgerTenant {
  id: number;
  tenant_id: number;
  name: string;
  unit: string | null;
}

/**
 * Mirrors the response returned by the ledger endpoint
 * (`LedgerView`): a DRF PageNumberPagination envelope with the ledger fields
 * lifted to the top level.
 *
 * GET /api/tenants/<id>/ledger/
 *   {
 *     "count": number,
 *     "next": string | null,
 *     "previous": string | null,
 *     "tenant": LedgerTenant,
 *     "balance": string,          // DecimalField, coerce_to_string
 *     "transaction_count": number,
 *     "results": Transaction[],
 *   }
 */
export interface LedgerResponse {
  count: number;
  next: string | null;
  previous: string | null;
  tenant: LedgerTenant;
  balance: string;
  transaction_count: number;
  results: Transaction[];
}
