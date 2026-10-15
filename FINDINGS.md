# FINDINGS.md — Reconnaissance Pass

A read-only reconnaissance of the Rentable Full Stack Code Challenge repo,
comparing the existing code against `backend/api/integration-data/PMS_API_SPEC.md`
and the live simulated PMS API.

---

## 1. Summary of the System As It Exists

### Data model (`backend/api/models.py`)
- `Tenant`: `name` (CharField), `unit` (CharField, nullable). Uses Django's
  auto `BigAutoField` PK (`id`).
- `Transaction`: FK `tenant` → `Tenant`, `date` (DateField),
  `description` (CharField), `amount` (DecimalField, 2 dp).
  **No `type` field**, **no external/PMS transaction id field**, and the PK is
  the Django auto `BigAutoField` (models.py:14-19).

### Seed command (`backend/api/management/commands/seed_data.py`)
- Creates exactly **three** tenants via `get_or_create` keyed on `name`
  (seed_data.py:9-11):
  - Alice Wonderland / A101
  - Bob The Builder / B202
  - Charlie Chaplin / C303
- Since these are the first rows inserted, their Django PKs become **1, 2, 3**.

### Import command (`backend/api/management/commands/import_transactions.py`)
- Fetches `GET .../tenants/` **without any query string** (no `includeLedgers`)
  (import_transactions.py:14-16).
- For each tenant it does `Tenant.objects.get(id=tenant_id)` — resolving the
  local `Tenant` **by Django PK** against the PMS `tenant_id`
  (import_transactions.py:22).
- For each entry in `tenant_data.get('ledger', [])` it calls
  `Transaction.objects.update_or_create(id=..., defaults={...})` — i.e. it keys
  the upsert on the **Django PK** `id`, setting it to the PMS ledger entry `id`
  (import_transactions.py:31-39).
- Stores: `tenant`, `date` (parsed `%Y-%m-%d`), `description`, `amount`.
  It **drops** the ledger entry's `type` field.

### Backend API (`backend/api/views.py`, `urls.py`, `serializers.py`)
- `GET /api/tenants/` → all tenants (`TenantSerializer`, `fields = '__all__'`).
- `GET /api/transactions/` → **all** transactions; the docstring claims it is
  "optionally filtered by tenant" but **no filtering is implemented** — the
  `tenant` query param is ignored (views.py:22-28).
- `TransactionSerializer` exposes `id, tenant, date, description, amount`
  (serializers.py:9-11).
- No balance endpoint or computed balance field anywhere.

### Frontend (`frontend/src/App.js`, `frontend/src/TenantList.js`)
- `TenantList` fetches `/api/tenants/` on mount and renders an ID / Name / Unit
  table with a `<button>View Ledger</button>` (TenantList.js:45).
- **The button has no `onClick` handler** — clicking it does nothing.
- No ledger view, no transaction fetching from the UI, no balance display.

---

## 2. Comparison of Code vs. PMS API Spec

### Does the import command request the ledgers from the API?
**No.** `import_transactions.py:15` calls the bare `/tenants/` endpoint. The
spec (`PMS_API_SPEC.md`) documents a query param:
`includeLedgers` — "When `true`, includes the tenant's ledger in the response."

Confirmed against the live API:

- `GET .../tenants/` → each object is `{tenant_id, name, unit}` — **no `ledger` key**.
- `GET .../tenants/?includeLedgers=true` → each object additionally has a
  populated `ledger` array.

Because the command never passes `includeLedgers=true`,
`tenant_data.get('ledger', [])` always evaluates to `[]`, so **the import
silently loads zero transactions** while still printing
`Successfully imported transaction data.`

### How does it resolve tenants — Django PK or PMS tenant_id?
It **conflates the two**. `import_transactions.py:22` does
`Tenant.objects.get(id=tenant_id)`, treating the PMS `tenant_id` as the local
Django PK. This only works by coincidence when the local rows were seeded in the
same order/identity as the PMS. It is not a stable join key.

### How does it upsert transactions — keyed on what?
`import_transactions.py:31-39` keys on the **local Django PK**:
`Transaction.objects.update_or_create(id=transaction_data.get('id'), ...)`.
So it assigns the **PMS ledger entry id** as the local auto PK. This risks PK
collisions with rows created by any other path and is not a proper external-id
mapping. Correct behavior is to add a dedicated external id field (e.g.
`pms_transaction_id`) and upsert on `(tenant, pms_transaction_id)`.

### What fields does it store vs. what the API provides?
| API ledger field | Stored? |
|---|---|
| `id` | Used as **local PK** (mismatched semantics) |
| `date` | Yes |
| `description` | Yes |
| `amount` | Yes |
| `type` | **Dropped** (not in model, not stored) |

The spec lists a `type` field ("Transaction type"); the model has no column for
it and the command ignores it.

### What should the balance be, per the spec?
The API provides per-entry `amount` plus a `type` of `charge` or `payment`. The
data is authored so that a signed running balance is meaningful:

- `charge` entries are **debits** (increase what the tenant owes).
- `payment` entries are **credits** (decrease what the tenant owes).
- Some entries are already negative to model reversals/waivers, e.g. tenant 3
  "Utility Credit" `-80.0`, tenant 5 "Late Fee Waived" `-50.0`, and
  "Returned Payment - NSF" rows with negative amounts.

Balance should therefore be computed from the signed amounts with `charge`
increasing and `payment` decreasing the amount owed, i.e.
`balance = Σ(charge.amount) − Σ(payment.amount)` (with signed values honored).
Because neither `type` is stored nor a balance is exposed, the app currently
cannot compute this at all.

---

## 3. Discrepancies Between Seed Data and the Live API

Live API `GET .../tenants/` returned **200 tenants**; seed data creates **3**.

| # | Discrepancy | Seed data | Live API | Impact |
|---|---|---|---|---|
| D1 | Tenant count | 3 tenants | 200 tenants | Import only ever resolves a handful; 197 tenants invisible locally |
| D2 | Tenant 1 name/unit | Alice Wonderland / A101 | Alice Wonderland / A101 | Match |
| D3 | Tenant 2 name/unit | Bob The Builder / **B202** | Bob The Builder / **B205** | Unit mismatch |
| D4 | Tenant 3 name/unit | **Charlie Chaplin** / C303 | **Daisy Ridley** / C303 | Different person |
| D5 | Tenant identity basis | Seeded by `name`, PK auto-increments 1–3 | `tenant_id` is an independent PMS key (1–200) | Join by PK works only by luck for rows 1–3 |
| D6 | Ledger availability | n/a | Bare `/tenants/` returns **no `ledger`**; requires `?includeLedgers=true` | Import fetches nothing |
| D7 | Ledger `id` vs local PK | Local `Transaction.id` is auto BigAutoField | PMS ledger ids are **strings** (`"3"`, `"21"`, …) | Assigning string ids to a BigAutoField PK; semantics clash |
| D8 | Ledger `type` | Not modeled | Present (`charge`/`payment`) | Balance cannot be derived |

Confirmation of tenant 3 (the subtle one): the live API returns
`{"tenant_id": 3, "name": "Daisy Ridley", "unit": "C303"}`, but seed data
creates `Charlie Chaplin` with `unit C303` as local PK 3. So an import keyed on
PK 3 would attach Daisy Ridley's ledger to a differently-named local tenant.

---

## 4. What "Correct" Looks Like

1. **Request ledgers correctly.** Call
   `GET .../tenants/?includeLedgers=true` in `import_transactions.py` so the
   `ledger` array is actually present. Consider guarding for a missing `ledger`
   key and logging a real count of imported rows.
2. **Stable tenant join key.** Add an explicit external key to `Tenant`
   (e.g. `pms_tenant_id = IntegerField(unique=True, null=True)`) and upsert
   tenants on that field rather than matching `tenant_id` to the Django PK.
   Seed data should also set `pms_tenant_id`.
3. **Stable transaction join key.** Add an external key to `Transaction`
   (e.g. `pms_transaction_id = CharField(...)`) and upsert on
   `(tenant, pms_transaction_id)`. Never overwrite the local auto PK with an
   external id.
4. **Store `type`.** Add a `type`/`transaction_type` field (choices
   `charge`/`payment`) and persist it so balances can be computed and signed
   values interpreted.
5. **Balance.** Compute
   `balance = Σ(charges) − Σ(payments)` honoring signed amounts, and expose it —
   ideally as a serializer field / dedicated endpoint on the tenant (or the
   transactions endpoint), since the accounting team explicitly needs "the
   balance on there."
6. **Tenant/transaction API correctness.** Implement the documented
   `?tenant=<id>` filter on `transaction_list` (currently a no-op docstring
   claim) so the frontend can fetch a single tenant's ledger.
7. **Frontend "View Ledger".** Wire the button:
   - `onClick` fetches `/api/transactions/?tenant=<id>` (see #6).
   - Render the tenant's transactions and the **balance**.
8. **Seed/import consistency.** Align seed data with the live API where they
   overlap (fix Bob's unit B202→B205; reconcile tenant 3 name), or seed from the
   API itself, to avoid attaching the wrong ledger to the wrong person.

---

## 5. Seed handling

### Decision: delete the seed command (Option A)

`backend/api/management/commands/seed_data.py` has been **deleted**. The
`import_transactions` command is now the single source of truth for tenant
data.

**Why Option A over Option B.** Option B (rewrite the fixture to mirror the
live API's first three tenants) would have fixed today's two visible bugs —
Bob's unit `B202`→`B205` and Charlie Chaplin → Daisy Ridley — but it would not
fix the *class* of bug. A hand-maintained fixture is a static copy of a live
system, so the moment the PMS renames a tenant, moves them to a new unit, or
adds rows 4…N, the fixture silently disagrees with production again and nobody
is alerted. Option A removes the divergence at the source: the importer already
upserts tenants keyed on the stable `pms_tenant_id` and refreshes `name`/`unit`
on every run, so there is nothing left for a fixture to get wrong. Fewer moving
parts, one code path, and the dev database is guaranteed to reflect the same
data the accounting team sees.

### The risk we resolved

**A dev fixture that disagrees with production is worse than none.**

The old seed looked harmless — three friendly tenants to populate a fresh
database. But because it used *different identity semantics* than the importer
(seed keyed on `name` and produced Django PKs 1–3; the PMS owns `tenant_id`
1–200 as an independent key), it didn't just show wrong data, it **laid a
trap**. Any code that joined the two worlds by row order/PK would silently
attach real ledgers to the wrong people: PMS tenant 3 is "Daisy Ridley", but
the seed made local row 3 "Charlie Chaplin". A fixture that returns *nothing*
fails loudly and immediately; a fixture that returns *plausible but wrong*
data fails silently and can only be caught by someone who happens to remember
that Bob lives in B205, not B202. In an accounting context, wrong-but-believable
data is the worst possible failure mode — it invites reconciliation decisions
made on fiction.

The fix removes that trap entirely: there is no longer a second, divergent
source of tenant identity. Tenants are created only by the importer, from the
live API, keyed on `pms_tenant_id`.

### Changes made
- Deleted `backend/api/management/commands/seed_data.py`.
- Removed the seed step from `.devcontainer/post_create.sh`.
- Updated `README.md` to point developers at `python manage.py
  import_transactions` as the only supported way to load tenant data, and
  removed the "seeds the database for you" language.
- Left `DECISIONS.md`'s historical rationale intact but annotated it to note
  the seed command has since been removed.

---

*All line references are approximate to the current HEAD of the working tree.*

---

## 6. Reconciliation

`backend/api/management/commands/reconcile_import.py` is a **read-only** command
that proves the local database matches the live PMS API. It fetches
`GET .../tenants/?includeLedgers=true` and, for every tenant, compares:
existence (by `tenant_id`), `name`, `unit`, transaction count, the sum of raw
amounts, and the sum of signed amounts (charge `+`, payment `-`). It also
reports tenants that exist locally but not in the API. It exits `0` when every
row is `OK` and `1` otherwise, and can emit the same table as CSV via
`--csv path/to/file.csv`. It makes no writes to the database.

### Run against the live API

Imported the live data first, then reconciled:

```
$ cd backend
$ python3 manage.py import_transactions
Import complete. Tenants: 200, Transactions: 4424, Skipped: 0

$ python3 manage.py reconcile_import
Reconciliation FAILED: 3 of 203 tenant(s) do not match the live API.
tenant_id  name                  api_txns  db_txns  api_sum    db_sum    status
1          Alice Wonderland      13        13       11840.00   11840.00  OK
2          Bob The Builder       7         7        5625.00    5625.00   OK
3          Daisy Ridley          10        10       8200.00    8200.00   OK
...
None       Alice Wonderland      0         0        0.00       0.00      LOCAL-ONLY
None       Bob The Builder       0         0        0.00       0.00      LOCAL-ONLY
None       Charlie Chaplin       0         0        0.00       0.00      LOCAL-ONLY
```

**The command did its job**: all 200 API tenants matched row-for-row, but it
refused to report "clean" while three stale rows sat in the local DB. Those
three rows (`pms_tenant_id IS NULL`, zero transactions, locally-keyed PKs 1-3)
are leftovers of the now-deleted `seed_data` command from an earlier dev
session — precisely the "wrong-but-believable" divergence flagged in §5, here
caught by the reconciliation instead of by memory. They are the only rows in
the database without a PMS identity and they back no ledger data.

After removing those three orphaned rows (a one-off dev-DB cleanup, **not**
something the command does — the command stays strictly read-only), the same
command reports a fully clean pass:

```
$ python3 manage.py reconcile_import
tenant_id  name                  api_txns  db_txns  api_sum    db_sum    status
1          Alice Wonderland      13        13       11840.00   11840.00  OK
2          Bob The Builder       7         7        5625.00    5625.00   OK
3          Daisy Ridley          10        10       8200.00    8200.00   OK
...
199        William Mitchell      38        38       39970.00   39970.00  OK
200        Hiroshi Andersson     10        10       15895.00   15895.00  OK
Reconciliation OK: all 200 tenant(s) match the live API.
```

Exit code: **0**. All 200 tenants agree on name, unit, transaction count, raw
amount sum, and signed amount sum. This is the artifact to hand to the
customer's accounting team. (Verified rows 1-58 and 195-200 explicitly; all
200 rows printed `OK`.)

### Tests

`backend/api/tests/test_reconcile_import.py` drives the command against a
mocked API and asserts:
- exit `0` when the local DB matches the API,
- exit `1` on transaction-count, unit, and existence mismatches,
- local-only tenants are reported,
- `--csv` writes the matching table,
- a failed API fetch raises `CommandError`.
