"""Read-only reconciliation between the live PMS API and the local database.

This command proves that what we have stored locally matches what the live PMS
returns, per tenant. It is the trust artifact we hand to a customer's
accounting team: if it exits 0, every tenant's name, unit, transaction count,
raw amount total, and signed amount total agree with the source of truth.

Design notes:
- Strictly read-only. It never writes to the database. The only optional write
  is the ``--csv`` file the operator explicitly asks for.
- It reuses the same parsing rules as ``import_transactions`` so a mismatch
  here means genuine drift, not a parsing difference.
"""

import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation

import requests
from django.core.management.base import BaseCommand, CommandError

from api.models import Tenant

INTEGRATION_API_URL = (
    "https://kpsaflrfjmhwomxiqrtiplvqem0hfmec.lambda-url.us-east-2.on.aws/"
    "api/simulated-pms-integration-api/tenants/"
)
REQUEST_TIMEOUT_SECONDS = 30
DATE_FORMAT = "%Y-%m-%d"

# Column widths for the on-screen table. Columns are separated by two spaces.
COLUMNS = (
    ("tenant_id", 9),
    ("name", 20),
    ("api_txns", 8),
    ("db_txns", 7),
    ("api_sum", 9),
    ("db_sum", 8),
    ("status", 12),
)


def signed_amount(amount, txn_type):
    """Apply the ledger sign convention: charges +, payments -.

    The raw API amount is preserved as-is; this only flips the sign for
    ``payment`` rows so the sum reflects what the tenant owes. Any other/absent
    type is treated as a charge (positive), matching the ledger endpoint.
    """
    if txn_type == "payment":
        return -amount
    return amount


class Command(BaseCommand):
    help = (
        "Reconcile the local database against the live PMS API. Read-only. "
        "Exits 1 if any tenant mismatches."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--csv",
            dest="csv_path",
            default=None,
            help="Also write the reconciliation table to this CSV path.",
        )

    def handle(self, *args, **options):
        csv_path = options.get("csv_path")

        tenants_data = self._fetch_live_tenants()
        rows = self._build_rows(tenants_data)

        self._print_table(rows)

        if csv_path:
            self._write_csv(csv_path, rows)
            self.stdout.write(f"Wrote reconciliation table to {csv_path}")

        mismatches = [row for row in rows if row["status"] != "OK"]

        if mismatches:
            # Exit 1 is the signal a CI job or a human relies on. The message
            # goes to stderr so it is visible even when stdout is redirected.
            self.stderr.write(
                self.style.ERROR(
                    f"Reconciliation FAILED: {len(mismatches)} of {len(rows)} "
                    f"tenant(s) do not match the live API."
                )
            )
            raise SystemExit(1)

        self.stdout.write(
            self.style.SUCCESS(
                f"Reconciliation OK: all {len(rows)} tenant(s) match the live API."
            )
        )

    def _fetch_live_tenants(self):
        """Fetch tenants with their ledgers. Read-only, single request."""
        try:
            response = requests.get(
                INTEGRATION_API_URL,
                params={"includeLedgers": "true"},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            # A failed fetch is not a data mismatch; surface it clearly.
            raise CommandError(f"Error fetching data from integration API: {e}")

    def _build_rows(self, tenants_data):
        """Build one comparison row per tenant (API tenants first)."""
        api_tenant_ids = set()
        rows = []

        for tenant_data in tenants_data:
            tenant_id = tenant_data.get("tenant_id")
            api_tenant_ids.add(tenant_id)

            api_ledger = tenant_data.get("ledger") or []
            api_ledger = [entry for entry in api_ledger if self._is_valid(entry)]
            api_txns = len(api_ledger)
            api_raw_sum = sum(
                (Decimal(str(entry["amount"])) for entry in api_ledger),
                Decimal("0.00"),
            )
            api_signed_sum = sum(
                (
                    signed_amount(Decimal(str(entry["amount"])), entry.get("type"))
                    for entry in api_ledger
                ),
                Decimal("0.00"),
            )

            local = Tenant.objects.filter(pms_tenant_id=tenant_id).first()

            if local is None:
                rows.append(
                    {
                        "tenant_id": tenant_id,
                        "name": tenant_data.get("name", ""),
                        "api_txns": api_txns,
                        "db_txns": 0,
                        "api_sum": api_raw_sum,
                        "db_sum": Decimal("0.00"),
                        "status": "MISSING (DB)",
                    }
                )
                continue

            db_transactions = list(local.transactions.all())
            db_txns = len(db_transactions)
            db_raw_sum = sum(
                (t.amount for t in db_transactions), Decimal("0.00")
            )
            db_signed_sum = sum(
                (signed_amount(t.amount, t.type) for t in db_transactions),
                Decimal("0.00"),
            )

            status = self._status(
                name_matches=local.name == tenant_data.get("name", ""),
                unit_matches=local.unit == tenant_data.get("unit"),
                txns_match=api_txns == db_txns,
                raw_sum_matches=api_raw_sum == db_raw_sum,
                signed_sum_matches=api_signed_sum == db_signed_sum,
            )

            rows.append(
                {
                    "tenant_id": tenant_id,
                    "name": local.name,
                    "api_txns": api_txns,
                    "db_txns": db_txns,
                    "api_sum": api_raw_sum,
                    "db_sum": db_raw_sum,
                    "status": status,
                }
            )

        rows.extend(self._local_only_rows(api_tenant_ids))
        return rows

    def _local_only_rows(self, api_tenant_ids):
        """Tenants present locally but absent from the live API."""
        rows = []
        local_only = (
            Tenant.objects.exclude(pms_tenant_id__in=api_tenant_ids)
            .order_by("pms_tenant_id")
        )
        for tenant in local_only:
            db_transactions = list(tenant.transactions.all())
            rows.append(
                {
                    "tenant_id": tenant.pms_tenant_id,
                    "name": tenant.name,
                    "api_txns": 0,
                    "db_txns": len(db_transactions),
                    "api_sum": Decimal("0.00"),
                    "db_sum": sum(
                        (t.amount for t in db_transactions), Decimal("0.00")
                    ),
                    "status": "LOCAL-ONLY",
                }
            )
        return rows

    @staticmethod
    def _status(
        name_matches,
        unit_matches,
        txns_match,
        raw_sum_matches,
        signed_sum_matches,
    ):
        """Return a concise status string, naming the first mismatch found."""
        problems = []
        if not name_matches:
            problems.append("NAME")
        if not unit_matches:
            problems.append("UNIT")
        if not txns_match:
            problems.append("TXNS")
        if not raw_sum_matches:
            problems.append("RAWSUM")
        if not signed_sum_matches:
            problems.append("SIGNSUM")
        return "OK" if not problems else "+".join(problems)

    @staticmethod
    def _is_valid(entry):
        """Mirror the importer's validity rules so we compare like for like."""
        try:
            int(entry["id"])
            datetime.strptime(entry["date"], DATE_FORMAT)
            Decimal(str(entry["amount"]))
        except (KeyError, TypeError, ValueError, InvalidOperation):
            return False
        return True

    def _print_table(self, rows):
        header = "".join(
            name.ljust(width) + "  " for name, width in COLUMNS
        ).rstrip()
        self.stdout.write(header)
        for row in rows:
            cells = (
                str(row["tenant_id"]).ljust(COLUMNS[0][1]),
                str(row["name"]).ljust(COLUMNS[1][1]),
                str(row["api_txns"]).ljust(COLUMNS[2][1]),
                str(row["db_txns"]).ljust(COLUMNS[3][1]),
                f"{row['api_sum']:.2f}".ljust(COLUMNS[4][1]),
                f"{row['db_sum']:.2f}".ljust(COLUMNS[5][1]),
                str(row["status"]).ljust(COLUMNS[6][1]),
            )
            self.stdout.write("".join(cell + "  " for cell in cells).rstrip())

    def _write_csv(self, csv_path, rows):
        with open(csv_path, "w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(
                ["tenant_id", "name", "api_txns", "db_txns", "api_sum", "db_sum", "status"]
            )
            for row in rows:
                writer.writerow(
                    [
                        row["tenant_id"],
                        row["name"],
                        row["api_txns"],
                        row["db_txns"],
                        f"{row['api_sum']:.2f}",
                        f"{row['db_sum']:.2f}",
                        row["status"],
                    ]
                )
