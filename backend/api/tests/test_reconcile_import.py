"""Tests for the read-only ``reconcile_import`` management command.

These tests drive the command against a mocked API and assert the exit code:
0 when everything matches, 1 when any tenant drifts from the live PMS.
"""

from decimal import Decimal
from io import StringIO

import responses
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from api.management.commands.import_transactions import INTEGRATION_API_URL
from api.models import Tenant, Transaction

# Two tenants whose local rows will exactly mirror the API.
FIXTURE = [
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


class ReconcileImportCommandTests(TestCase):
    def _mock_api(self, payload):
        responses.add(
            responses.GET,
            INTEGRATION_API_URL,
            json=payload,
            status=200,
        )

    def _seed_local_matching_api(self):
        """Create local rows that mirror FIXTURE exactly."""
        alice = Tenant.objects.create(
            name="Alice Wonderland", unit="A101", pms_tenant_id=1
        )
        Transaction.objects.create(
            tenant=alice,
            external_id=10,
            date="2024-01-01",
            description="Rent",
            amount=Decimal("100.00"),
            type="charge",
        )
        Transaction.objects.create(
            tenant=alice,
            external_id=11,
            date="2024-01-05",
            description="Partial payment",
            amount=Decimal("-25.50"),
            type="payment",
        )
        bob = Tenant.objects.create(
            name="Bob The Builder", unit="B205", pms_tenant_id=2
        )
        Transaction.objects.create(
            tenant=bob,
            external_id=20,
            date="2024-02-01",
            description="Utilities",
            amount=Decimal("80.00"),
            type="charge",
        )

    def _run(self):
        """Run the command, returning (exit_code, combined_output).

        ``call_command`` propagates the ``SystemExit`` the command raises on
        mismatch, so we translate it into an exit code for assertions. The
        failure summary goes to stderr, so we combine both streams.
        """
        out = StringIO()
        err = StringIO()
        try:
            call_command("reconcile_import", stdout=out, stderr=err)
        except SystemExit as e:
            return e.code, out.getvalue() + err.getvalue()
        return 0, out.getvalue() + err.getvalue()

    @responses.activate
    def test_exit_zero_when_local_matches_api(self):
        self._seed_local_matching_api()
        self._mock_api(FIXTURE)

        exit_code, out = self._run()

        self.assertEqual(exit_code, 0)
        self.assertIn("OK", out)
        self.assertIn("Reconciliation OK", out)
        self.assertNotIn("FAILED", out)

    @responses.activate
    def test_exit_one_when_transaction_count_differs(self):
        self._seed_local_matching_api()
        # Drop one of Alice's local transactions -> count + sums drift.
        Transaction.objects.filter(external_id=11).delete()
        self._mock_api(FIXTURE)

        exit_code, out = self._run()

        self.assertEqual(exit_code, 1)
        self.assertIn("TXNS", out)
        self.assertIn("Reconciliation FAILED", out)

    @responses.activate
    def test_exit_one_when_unit_differs(self):
        self._seed_local_matching_api()
        Tenant.objects.filter(pms_tenant_id=2).update(unit="B999")
        self._mock_api(FIXTURE)

        exit_code, out = self._run()

        self.assertEqual(exit_code, 1)
        self.assertIn("UNIT", out)

    @responses.activate
    def test_reports_local_only_tenant(self):
        self._seed_local_matching_api()
        Tenant.objects.create(
            name="Ghost Tenant", unit="Z999", pms_tenant_id=999
        )
        self._mock_api(FIXTURE)

        exit_code, out = self._run()

        self.assertEqual(exit_code, 1)
        self.assertIn("LOCAL-ONLY", out)
        self.assertIn("Ghost Tenant", out)

    @responses.activate
    def test_reports_tenant_missing_locally(self):
        # Only seed Bob locally; Alice exists in the API but not the DB.
        Tenant.objects.create(
            name="Bob The Builder", unit="B205", pms_tenant_id=2
        )
        self._mock_api(FIXTURE)

        exit_code, out = self._run()

        self.assertEqual(exit_code, 1)
        self.assertIn("MISSING (DB)", out)

    @responses.activate
    def test_csv_flag_writes_matching_table(self):
        self._seed_local_matching_api()
        self._mock_api(FIXTURE)

        import tempfile
        import os

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "out.csv")
            call_command("reconcile_import", csv=path, stdout=StringIO())
            with open(path) as handle:
                contents = handle.read()

        self.assertIn("tenant_id,name,api_txns,db_txns,api_sum,db_sum,status", contents)
        self.assertIn("Alice Wonderland", contents)

    @responses.activate
    def test_api_failure_raises_command_error(self):
        self._seed_local_matching_api()
        responses.add(
            responses.GET,
            INTEGRATION_API_URL,
            json={"detail": "boom"},
            status=500,
        )

        with self.assertRaises(CommandError):
            call_command("reconcile_import", stdout=StringIO())
