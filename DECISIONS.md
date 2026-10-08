# DECISIONS.md — Schema decisions

The model changes in this step are purely representational: they let the local
database hold the PMS data shape faithfully. No import or API logic is changed
yet.

### New fields
- `Tenant.tenant_id` — `IntegerField(unique=True, db_index=True, null=True)`.
- `Transaction.external_id` — `IntegerField(db_index=True)` (non-null after the
  final migration).
- `Transaction.type` — `CharField(max_length=50, blank=True, null=True)`.
- `Transaction.raw_payload` — `JSONField(blank=True, null=True)`.
- `Transaction.Meta.unique_together = [("tenant", "external_id")]`.

### Why `tenant_id` is separate from the Django PK
The Django PK (`id`) is an internal, auto-incrementing row identity. The PMS
`tenant_id` is a **business key owned by an external system**. They are not the
same thing and must not be assumed to line up — the seed command (since
removed; see "Seed handling" in FINDINGS.md) inserted a tenant (Charlie
Chaplin) that the PMS does not have, and only the rows seeded first happened
to share the PMS numbering (see D4/D5 in FINDINGS.md). Keeping them separate
lets imports join on the PMS identity, and
lets `unique=True` guard against two local rows claiming the same external
tenant. `null=True` is a deliberate migration-safety choice so locally-created
/ not-yet-synced tenants remain valid; it can be tightened to non-null once
every row is backfilled.

### Why `external_id` is separate from the Django PK
The old command did `update_or_create(id=<PMS ledger id>)`, i.e. it wrote an
external identifier into the local auto PK. That is a stable-identity bug: any
other code path that creates a transaction could collide with a PMS id, and
re-imports silently rewrite PKs. `external_id` stores the PMS ledger `id` (a
bare integer here, even though the API currently sends it as a JSON string)
beside the untouched local PK, so the two identities never fight.

### Why the upsert key is `(tenant, external_id)` and not `external_id` alone
The PMS ledger `id` is only unique **within a tenant's ledger** — the sample
data numbers entries globally, but nothing in the spec guarantees it, and real
PMS exports commonly restart numbering per lease/tenant. A plain `unique=True`
on `external_id` would be over-strict and could reject legitimate data; scoping
uniqueness to `(tenant, external_id)` matches the real cardinality while still
preventing duplicate imports of the same entry. It also mirrors a correct
idempotent upsert: `update_or_create(tenant=..., external_id=..., defaults={...})`.

### Why we store `raw_payload`
The current mapping is lossy and provisional (e.g. `type` was being dropped,
and the source sends `id` as a string). Persisting the verbatim ledger entry:
- preserves fields we don't yet map, so nothing is silently lost;
- makes it possible to re-derive mapped columns if a mapping assumption turns
  out wrong, without re-fetching from the external API;
- gives an audit trail for the accounting use case (reconciliation disputes);
- costs little, since each entry is a small JSON object.

### Migration ordering
- `0004_add_pms_identity_fields` — adds all new columns as **nullable / with
  defaults**, safe to apply to existing rows.
- `0005_dedupe_transactions` — data migration that deletes any pre-existing
  duplicate `(tenant, external_id)` rows (keeping the newest). The DB is
  assumed fresh for this challenge, so in practice it is a no-op; it exists so
  the chain is safe on a populated database.
- `0006_transaction_unique_together` — tightens `external_id` to non-null and
  adds the `unique_together` constraint, only after duplicates are resolved.

### Known limitation (balance)
The PMS encodes transaction direction **inconsistently**: normal entries carry
a `type` of `charge`/`payment`, but reversals/waivers instead use a **negative
amount** (e.g. tenant 3 "Utility Credit" `type=charge, amount=-80`; "Returned
Payment - NSF" `type=payment, amount=-1375`). A candidate balance formula
(`balance = Σ(charges) − Σ(payments)`, honoring signed amounts) is therefore
correct for the **majority** of records but not by design — it will be wrong
for edge cases the data authors did not intend as balance math. We store both
`type` and `raw_payload` precisely so this can be revisited; the balance
computation itself is out of scope for this step.
