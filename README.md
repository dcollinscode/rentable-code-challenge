# Rentable Full Stack Code Challenge

## Table of Contents
* [Project Overview](#project-overview)
    * [Simulated PMS API](#simulated-pms-api)
        * [API Spec](#api-spec)
* [Getting Started](#getting-started)
* [The Challenge](#the-challenge)
* [How to Submit](#how-to-submit)
* [FAQ](#faq)
* [Questions](#questions)

Welcome to the Rentable Full Stack Code Challenge! This challenge evaluates your ability to translate a business need into a working solution using AI-assisted development. AI tooling (e.g., Cursor, GitHub Copilot) is expected to be used, but you own every line of code you submit. Be prepared to walk through your implementation and explain why you chose the code you submitted.

## Project Overview

This project simulates a property management system for managing tenant's and their transaction ledgers.

There is a **React front end** that displays a list of Tenants with a button for viewing transaction ledgers. 

There is a **Python and Django backend** with APIs that return tenants and their transactions. The Django backend utilizes a SQLite database.

Transactions can be imported from the PMS integration API into the local database using the `import_transactions` management command. This command is the source of truth for tenant and transaction data: it pulls live tenants and their ledgers directly from the API.

### Simulated PMS API

Tenant and transaction data comes from a simulated external Property Management System (PMS) integration API, hosted separately from this project.

#### API Spec

[`backend/api/integration-data/PMS_API_SPEC.md`](backend/api/integration-data/PMS_API_SPEC.md)

## Getting Started

This repo includes a [Dev Container](https://containers.dev/) config (`.devcontainer/`). It's the quickest way to get running: the container installs dependencies and migrates the database for you. Not using Dev Containers? `.devcontainer/post_create.sh` shows what you'd need to do yourself.

To populate the database with tenant and transaction data, run the import command:

```
cd backend && python manage.py import_transactions && cd ..
```

This is the only supported way to load tenant data — there is no local seed fixture, so the database always reflects the live PMS integration API.

#### What the import does

`import_transactions` is the single source of truth for tenant and transaction
data. On each run it:

- fetches `GET .../tenants/?includeLedgers=true` **once**, so each tenant's
  `ledger` array is actually present (the bare endpoint returns tenants only);
- **upserts tenants** keyed on the PMS `tenant_id` (stored as
  `Tenant.pms_tenant_id`), refreshing `name` and `unit` on each run — never
  matching `tenant_id` against the Django PK;
- **upserts transactions** keyed on `(tenant, external_id)` under a
  `unique_together` constraint, so re-running the command is **idempotent** and
  never overwrites a local PK with an external id;
- stores the ledger entry's `type` (`charge`/`payment`) and the verbatim
  `raw_payload` for auditing and re-processing;
- **skips malformed records** (missing id/date, bad date format, unparsable
  amount) with a logged warning instead of crashing the whole import, and prints
  an honest summary: `Import complete. Tenants: N, Transactions: N, Skipped: N`.

Migration ordering makes the schema safe to apply to a populated database; see
[`DECISIONS.md`](DECISIONS.md) for the rationale behind each field.

Once set up, run `./start.sh` from the project root. The backend runs at [`http://127.0.0.1:8009/`](http://127.0.0.1:8009/) and the frontend at [`http://localhost:3009/`](http://localhost:3009/).

### The ledger endpoint

`GET /api/tenants/<id>/ledger/` returns a tenant's ledger and its computed
balance. It is **paginated** (50 per page, DRF `PageNumberPagination`),
ordered by `date` desc then `external_id` desc.

```
$ curl http://127.0.0.1:8009/api/tenants/1/ledger/
{
  "count": 2,
  "next": null,
  "previous": null,
  "tenant": { "id": 1, "tenant_id": 1, "name": "Alice Wonderland", "unit": "A101" },
  "balance": "1250.00",
  "transaction_count": 2,
  "results": [
    { "id": 5, "external_id": 5, "date": "2022-12-22",
      "description": "Payment", "amount": "250.00", "type": "payment" },
    { "id": 4, "external_id": 4, "date": "2022-12-21",
      "description": "Rent Charge", "amount": "500.00", "type": "charge" }
  ]
}
```

- `balance` is a **string** (`"1250.00"`) — a DRF `DecimalField` with
  `coerce_to_string`, so money is never silently turned into a float.
- The balance is computed in SQL: charges are `+`, payments are `-`.
- An **unknown tenant id returns `404`** with a clean `{"detail": "..."}` body.
- A tenant with **no transactions** returns `balance: "0.00"` and
  `results: []`.

### Reconciling the local data with the live PMS

`reconcile_import` is a **read-only** command that proves the local database
matches the live PMS integration API. It fetches the live tenants (with
ledgers) and, for each tenant, checks that the tenant exists, and that the
`name`, `unit`, transaction count, sum of raw amounts, and sum of signed
amounts (charge `+`, payment `-`) all agree. It also reports any tenants that
exist locally but are absent from the API.

```
cd backend && python manage.py reconcile_import && cd ..
```

It prints a per-tenant table:

```
tenant_id  name                  api_txns  db_txns  api_sum    db_sum    status
1          Alice Wonderland      23        23       4120.00    4120.00   OK
2          Bob The Builder       7         7        3125.00    3125.00   OK
5          Ghost Tenant          0         3        0.00       250.00    LOCAL-ONLY
```

- **Exit code 0** when every row is `OK`, **exit code 1** if any mismatch is
  found — so it can gate a CI job or a deploy.
- Pass `--csv path/to/file.csv` to also write the table to a CSV file
  (handy as evidence for a customer's accounting team).
- It never writes to the database; its only output is stdout and the optional
  CSV.

**When to run it:**
- **Before any customer-facing demo** — so you are never showing numbers that
  disagree with the source of truth.
- **Nightly in production** — to catch drift (a failed import, a partial sync,
  a manual DB edit) the moment it appears rather than after it reaches a
  customer's books.
- **Whenever the import is suspected of failing** — run
  `import_transactions` to refresh, then `reconcile_import` to confirm.

### Clicking through the ledger UI

Run both servers with `./start.sh`, then:

1. Open the frontend at [`http://localhost:3009/`](http://localhost:3009/).
2. The **Tenants** table lists every tenant loaded by the import. If it is
   empty, run `import_transactions` first (see above).
3. Click **View Ledger** on any row. A drawer slides in from the right showing
   the tenant's **current balance** and its transactions (date, description,
   type, signed amount). Payments render in green and amounts are formatted as
   currency (`$1,250.00`); money owed shows in red.
4. Close the drawer with the **×** button, by clicking the backdrop, or with
   **Escape**.

In development, a **"Ledger state (dev)"** dropdown above the table lets you
force the drawer into its Loading, Empty, or Error state for review without
editing code or the API.

### Running the tests

Backend (Django `TestCase`, API calls mocked with `responses`):

```
cd backend && python manage.py test
```

Frontend (Jest via Create React App; `fetch` is mocked):

```
cd frontend && npm test
```

## The Challenge

The Head of Accounting at Couchman & Wavehill, one of our largest customers, is asking for ledger functionality. Their accounting team needs more visibility into tenant financials to reconcile their books efficiently. A View Ledger button has been added, but it currently does nothing. When they click it, they should see that tenant's transactions. And they need to see the balance on there too. We're trying to expand our relationship with them, so we want to do everything we can so that they want to move forward.


## How to Submit

This project is configured as a GitHub Template repository for you to clone, solve, and then push to your own GitHub account. To submit your solution, please follow these steps:

1.  **Create Your Own Repository:** On the Rentable Full Stack Code Challenge GitHub page, click the green "Use this template" button. This will allow you to create a new repository under your own GitHub account, pre-populated with this challenge's codebase.

2.  **Clone Your Repository:** Clone your newly created repository to your local machine using `git clone`.

3.  **Complete the Challenge:** Work on the challenge within your local clone.

4.  **Push Your Changes:** Commit your changes and push them to your repository on GitHub.

5.  **IMPORTANT - Share the Link:** Share the URL of your completed GitHub repository with your hiring contact.


## FAQ

*   **Will this be part of the Technical Interview?:** Your submitted code will be reviewed during a follow-up technical interview, where we will discuss your how you went about learning the codebase and implementation details. We will also perform a live code exercise building upon your solution.

*   **Can I use AI Tooling?** Yes. AI development tools (e.g., GitHub Copilot, ChatGPT, Cursor AI) are expected to be used. Be prepared to thoroughly discuss your implementation decisions during the follow-up interview, including any choices suggested by AI tooling.

## Questions

If you have any questions about the challenge, please feel free to email your hiring contact.