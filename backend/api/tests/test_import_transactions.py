from decimal import Decimal

import responses
from django.core.management import call_command
from django.test import TestCase

from api.management.commands.import_transactions import INTEGRATION_API_URL
from api.models import Tenant, Transaction

# Small fixture: 2 tenants, 3 transactions total. The malformed entry is
# exercised in its own test by appending to this base payload.
FIXTURE = [
    {
        "tenant_id": 1,
        "name": "Alice Wonderland",
        "unit": "A101",
        "ledger": [
            {
                "id": "10",  # ids arrive as strings
                "date": "2024-01-01",
                "amount": "100.00",
                "type": "charge",
                "description": "Rent",
            },
            {
                "id": "11",
                "date": "2024-01-05",
                "amount": "-25.50",
                "type": "payment",
                "description": "Partial payment",
            },
        ],
    },
    {
        "tenant_id": 2,
        "name": "Bob The Builder",
        "unit": "B205",
        "ledger": [
            {
                "id": "20",
                "date": "2024-02-01",
                "amount": "80.0",
                "type": "charge",
                "description": "Utilities",
            },
        ],
    },
]


class ImportTransactionsCommandTests(TestCase):
    def _mock_api(self, payload):
        responses.add(
            responses.GET,
            INTEGRATION_API_URL,
            json=payload,
            status=200,
        )

    @responses.activate
    def test_imports_tenants_and_transactions_with_ledgers_included(self):
        self._mock_api(FIXTURE)

        call_command("import_transactions")

        # Requested exactly once, with includeLedgers=true.
        self.assertEqual(len(responses.calls), 1)
        self.assertIn("includeLedgers=true", responses.calls[0].request.url)

        self.assertEqual(Tenant.objects.count(), 2)
        self.assertEqual(Transaction.objects.count(), 3)

        # Tenants are joined on the PMS tenant_id, not the Django PK.
        alice = Tenant.objects.get(pms_tenant_id=1)
        self.assertEqual(alice.name, "Alice Wonderland")
        self.assertEqual(alice.unit, "A101")

        # Amounts are stored as Decimal, not float.
        txn = Transaction.objects.get(tenant=alice, external_id=10)
        self.assertEqual(txn.amount, Decimal("100.00"))
        self.assertEqual(txn.type, "charge")
        self.assertEqual(txn.description, "Rent")
        # Raw payload retained verbatim.
        self.assertEqual(txn.raw_payload, FIXTURE[0]["ledger"][0])

    @responses.activate
    def test_running_twice_is_idempotent(self):
        self._mock_api(FIXTURE)

        call_command("import_transactions")
        first_snapshot = self._snapshot()

        call_command("import_transactions")
        second_snapshot = self._snapshot()

        self.assertEqual(first_snapshot, second_snapshot)
        self.assertEqual(Tenant.objects.count(), 2)
        self.assertEqual(Transaction.objects.count(), 3)

    @responses.activate
    def test_malformed_record_is_skipped_without_crashing(self):
        payload = [
            {
                "tenant_id": 1,
                "name": "Alice Wonderland",
                "unit": "A101",
                "ledger": [
                    {
                        "id": "10",
                        "date": "2024-01-01",
                        "amount": "100.00",
                        "type": "charge",
                        "description": "Rent",
                    },
                    # Missing id -> skipped.
                    {"date": "2024-01-02", "amount": "5.00"},
                    # Bad date format -> skipped.
                    {
                        "id": "12",
                        "date": "not-a-date",
                        "amount": "5.00",
                        "type": "charge",
                        "description": "Broken",
                    },
                ],
            },
        ]
        self._mock_api(payload)

        call_command("import_transactions")

        self.assertEqual(Transaction.objects.count(), 1)
        self.assertEqual(Tenant.objects.count(), 1)

    def _snapshot(self):
        return (
            sorted(Tenant.objects.values_list("pms_tenant_id", "name", "unit")),
            sorted(
                Transaction.objects.values_list(
                    "tenant__pms_tenant_id",
                    "external_id",
                    "date",
                    "description",
                    "amount",
                    "type",
                )
            ),
        )
