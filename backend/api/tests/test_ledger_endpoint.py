from decimal import Decimal

from django.test import TestCase
from django.urls import reverse

from api.models import Tenant, Transaction


class LedgerEndpointTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Alice Wonderland", unit="A101", pms_tenant_id=1
        )

    def _url(self, pk):
        return f"/api/tenants/{pk}/ledger/"

    def test_balance_is_computed_correctly(self):
        # charge 1000, charge 500, payment 250 -> balance 1250
        Transaction.objects.create(
            tenant=self.tenant,
            date="2022-12-20",
            description="Security Deposit Charge",
            amount=Decimal("1000.00"),
            external_id=3,
            type="charge",
        )
        Transaction.objects.create(
            tenant=self.tenant,
            date="2022-12-21",
            description="Rent Charge",
            amount=Decimal("500.00"),
            external_id=4,
            type="charge",
        )
        Transaction.objects.create(
            tenant=self.tenant,
            date="2022-12-22",
            description="Payment",
            amount=Decimal("250.00"),
            external_id=5,
            type="payment",
        )

        response = self.client.get(self._url(self.tenant.id))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["balance"], "1250.00")
        self.assertEqual(data["transaction_count"], 3)
        self.assertEqual(data["tenant"]["id"], self.tenant.id)
        self.assertEqual(data["tenant"]["name"], "Alice Wonderland")
        self.assertEqual(data["tenant"]["unit"], "A101")
        # Ordered by date desc, then external_id desc.
        self.assertEqual(
            [t["external_id"] for t in data["results"]], [5, 4, 3]
        )

    def test_tenant_with_no_transactions(self):
        response = self.client.get(self._url(self.tenant.id))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["balance"], "0.00")
        self.assertEqual(data["transaction_count"], 0)
        self.assertEqual(data["results"], [])

    def test_missing_tenant_returns_404(self):
        response = self.client.get(self._url(999999))
        self.assertEqual(response.status_code, 404)

    def test_balance_is_a_string_not_a_float(self):
        Transaction.objects.create(
            tenant=self.tenant,
            date="2022-12-20",
            description="Charge",
            amount=Decimal("10.00"),
            external_id=1,
            type="charge",
        )

        data = self.client.get(self._url(self.tenant.id)).json()

        self.assertIsInstance(data["balance"], str)
        self.assertNotIsInstance(data["balance"], float)
