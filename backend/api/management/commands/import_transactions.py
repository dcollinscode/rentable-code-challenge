from datetime import datetime
from decimal import Decimal, InvalidOperation

import requests
from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Tenant, Transaction

INTEGRATION_API_URL = (
    "https://kpsaflrfjmhwomxiqrtiplvqem0hfmec.lambda-url.us-east-2.on.aws/"
    "api/simulated-pms-integration-api/tenants/"
)
REQUEST_TIMEOUT_SECONDS = 30
DATE_FORMAT = "%Y-%m-%d"


class Command(BaseCommand):
    help = "Imports tenant and transaction data from the integration API into the Django database."

    def handle(self, *args, **options):
        self.stdout.write("Starting transaction import...")

        # 1. Fetch everything we need in a single request, with ledgers included.
        try:
            response = requests.get(
                INTEGRATION_API_URL,
                params={"includeLedgers": "true"},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            tenants_data = response.json()
        except requests.exceptions.RequestException as e:
            self.stderr.write(f"Error fetching data from integration API: {e}")
            return

        tenants_imported = 0
        transactions_imported = 0
        skipped = 0

        for tenant_data in tenants_data:
            # 2. Upsert tenant on the PMS tenant_id (a stable business key),
            #    not the Django PK, and refresh name/unit on conflict.
            tenant_pms_id = tenant_data.get("tenant_id")
            if tenant_pms_id is None:
                self.stderr.write("Skipping tenant record with no tenant_id.")
                skipped += 1
                continue

            tenant, _ = Tenant.objects.update_or_create(
                pms_tenant_id=tenant_pms_id,
                defaults={
                    "name": tenant_data.get("name", ""),
                    "unit": tenant_data.get("unit"),
                },
            )
            tenants_imported += 1

            # 3. Upsert each ledger entry, keyed on (tenant, external_id).
            for entry in tenant_data.get("ledger") or []:
                try:
                    external_id = int(entry["id"])  # API sends ids as strings
                    date_value = datetime.strptime(entry["date"], DATE_FORMAT).date()
                except (KeyError, TypeError, ValueError):
                    # Missing id/date or a bad date format: log and move on.
                    self.stderr.write(
                        f"Skipping malformed ledger entry for tenant "
                        f"{tenant_pms_id}: {entry!r}"
                    )
                    skipped += 1
                    continue

                try:
                    amount = Decimal(str(entry["amount"]))
                except (KeyError, TypeError, InvalidOperation):
                    self.stderr.write(
                        f"Skipping ledger entry with invalid amount for tenant "
                        f"{tenant_pms_id}: {entry!r}"
                    )
                    skipped += 1
                    continue

                # 4. Wrap each record so a failure can't leave a partial write.
                with transaction.atomic():
                    Transaction.objects.update_or_create(
                        tenant=tenant,
                        external_id=external_id,
                        defaults={
                            "date": date_value,
                            "description": entry.get("description") or "",
                            "amount": amount,
                            "type": entry.get("type"),
                            "raw_payload": entry,
                        },
                    )
                transactions_imported += 1

        # 5. Always report a real, honest summary.
        self.stdout.write(
            f"Import complete. Tenants: {tenants_imported}, "
            f"Transactions: {transactions_imported}, Skipped: {skipped}"
        )
