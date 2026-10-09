# DECISIONS.md

Engineering decisions behind the ledger feature. Each item states **what** was
decided (one sentence) and **why** (two sentences), in the order a reviewer is
likely to ask about them.

---

## 1. Why `tenant_id` is separate from Django's PK

**What:** We added `Tenant.pms_tenant_id` (`IntegerField(unique=True, nullable,
db_index=True)`) as a distinct field rather than reusing the Django auto `id`.

**Why:** The Django PK is an internal, auto-incrementing row identity owned by our
database, whereas `tenant_id` is a business key owned by an external system we do
not control. Conflating them only works by coincidence — an earlier `seed_data`
command produced local rows 1–3 that happened to collide with different PMS
tenants (PMS tenant 3 was "Daisy Ridley", local row 3 was "Charlie Chaplin"),
which silently attached the wrong ledger to the wrong person. Keeping them
separate lets imports join on the stable PMS identity and lets `unique=True` guard
against two local rows claiming the same external tenant.

## 2. Why the Transaction upsert key is `(tenant, external_id)`

**What:** Transactions are upserted with
`update_or_create(tenant=..., external_id=..., defaults={...})` under a
`unique_together = [("tenant", "external_id")]` constraint.

**Why:** The PMS ledger `id` is unique only *within* a tenant's ledger — real PMS
exports commonly restart numbering per lease/tenant, so a global `unique=True` on
`external_id` would be over-strict and could reject legitimate data. Scoping
uniqueness to the pair matches the real cardinality while still preventing
duplicate imports of the same entry, and it makes re-running the importer
idempotent. This also replaces the old bug where the command wrote the external id
into the local auto PK, which risked collisions with any other row-creating code
path.

## 3. Why amounts are stored and serialized as Decimal, not float

**What:** `Transaction.amount` is a `DecimalField(max_digits=10, decimal_places=2)`
and the ledger endpoint serializes the balance with `coerce_to_string=True` (a
JSON string like `"1250.00"`).

**Why:** Floats are binary fractions and cannot represent values like `0.10`
exactly, so summing them produces cents-level drift that is unacceptable on
financial ledgers. Keeping the value as `Decimal` end to end — DB, sums, and wire
format — guarantees exact two-decimal arithmetic, and serializing as a string
avoids reintroducing a float on the client's JSON parser. The frontend parses the
string only at the last moment for display formatting.

## 4. Why the balance formula treats charge as `+` and payment as `-`

**What:** Balance is computed in SQL as
`Σ(type == "charge" ? +amount : type == "payment" ? -amount : +amount)` — charges
add to what the tenant owes, payments subtract.

**Why:** In the PMS data a `charge` is a debit (rent, fees) that increases the
tenant's outstanding balance, while a `payment` is a credit that reduces it. This
matches the plain-English meaning of "current balance" that the accounting team
asked for, and it is applied consistently in both the ledger endpoint and the
`reconcile_import` command so the two never disagree. Signed `amount` values are
honored as-is within that rule, which is how the edge cases below are handled.

## 5. How edge cases (negative-amount charges, NSF returns) are handled

**What:** The rule is applied to the *signed* amount rather than the magnitude, so
a `type=charge, amount=-80` row (a credit/waiver) and a
`type=payment, amount=-1375` row ("Returned Payment - NSF") both flow through the
same formula and net out to their intuitive direction.

**Why:** The PMS encodes direction inconsistently — most rows carry a clean
`charge`/`payment` type, but reversals use a negative amount instead of flipping
the type, so any formula that assumed `amount` is always positive would be wrong
for those rows. By storing both `type` and the verbatim `raw_payload`, we keep the
data needed to revisit the convention if the PMS ever changes it. The reconciler
compares both the raw sum and the signed sum for every tenant, so any divergence in
this treatment surfaces immediately rather than quietly skewing a balance.

## 6. Why "View Ledger" opens as a modal / route

**What:** Clicking "View Ledger" opens an overlay drawer (`LedgerView`) rendered in
place over the tenant list, rather than navigating to a separate page.

**Why:** The accounting team's workflow is "scan the tenant list, then inspect one
tenant" — a modal preserves the list context and makes switching between tenants a
single click, without re-fetching or losing the list's scroll position. It also
kept the change contained to the existing single-page app, avoiding a router
dependency for what is fundamentally one piece of detail UI. The drawer closes on
`Escape`, on backdrop click, and via an explicit close button, so it never traps
the user.

## 7. Why the `reconcile_import` command exists and how often it should run

**What:** `reconcile_import` is a read-only management command that fetches the
live tenants and, per tenant, verifies existence plus `name`, `unit`, transaction
count, raw amount sum, and signed amount sum, exiting `0` on a clean match and `1`
on any drift.

**Why:** It is the trust artifact we can hand a customer's accounting team: a
single command that *proves* the local database agrees with the source of truth,
and whose exit code can gate CI or a deploy. It never writes to the database (its
only optional output is a `--csv` file the operator asks for), so it is always
safe to run. Run it **before any customer-facing demo**, **nightly in production**
to catch drift the moment it appears, and **whenever an import is suspected of
failing** (refresh with `import_transactions`, then confirm with
`reconcile_import`).

## 8. What the "known limitations" of this implementation are

**What:** Known limitations are: tenant data is only as fresh as the last import
(no background sync); the balance treats any non-`payment` type as a charge and
does not model partial-payment or NSF timing; the tenant ledger pagination is
fixed at 50 with no page-size override (the tenants list, by contrast, is
page-size configurable — see §9); and reconciliation compares aggregates, not
row-by-row contents.

**Why:** These are deliberate scope choices for the challenge rather than
oversights — the importer is the single source of truth and the reconciler is the
safety net that catches staleness or drift. Row-level reconciliation (matching
individual `external_id`s rather than counts and sums) would catch rarer
"same-total, different-rows" cases and is the natural next step, as is a scheduled
import job. Each limitation is bounded and observable: if it matters, one of the
existing checks will flag it before it reaches a customer's books.

---

## 9. Why the tenants list page size is 25

**What:** `GET /api/tenants/` uses DRF `PageNumberPagination` with `page_size =
25`, `page_size_query_param = "page_size"`, and `max_page_size = 100`, ordered by
`name` then `id`.

**Why:** 25 is the sweet spot for a table view: it is small enough that the first
paint only renders a screen-and-a-half of rows (the original complaint was that
200 rows rendered at once), yet large enough to cover a typical result in a single
page without the user paging. The `page_size` query param lets a client opt into
denser or lighter views, and `max_page_size = 100` caps the worst case so a single
request can never pull the whole 200-tenant table and defeat the point. Ordering
by `name` with `id` as a tiebreaker makes the slice deterministic, so a tenant can
never appear twice or be skipped as the client pages through.

---

## Appendix: migration ordering

The schema fields above were introduced across three migrations, ordered so the
chain is safe to apply to a populated database:

- `0004_add_pms_identity_fields` — adds `pms_tenant_id`, `external_id`, `type`,
  and `raw_payload` as **nullable / with defaults**, safe on existing rows.
- `0005_dedupe_transactions` — data migration that deletes any pre-existing
  duplicate `(tenant, external_id)` rows (keeping the newest). The DB is expected
  to be fresh for this challenge, so in practice it is a no-op; it exists so the
  chain is safe on a populated database.
- `0006_transaction_unique_together` — tightens `external_id` to non-null and adds
  the `unique_together` constraint, only after duplicates are resolved.
