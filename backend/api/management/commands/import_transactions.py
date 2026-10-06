from django.core.management.base import BaseCommand, CommandError
from api.models import Transaction, Tenant
import requests
import json
from datetime import datetime

class Command(BaseCommand):
    help = 'Imports transaction data from the integration API into the Django database.'

    def handle(self, *args, **options):
        self.stdout.write('Starting transaction import...')

        integration_api_url = "https://kpsaflrfjmhwomxiqrtiplvqem0hfmec.lambda-url.us-east-2.on.aws/api/simulated-pms-integration-api/tenants/"
        try:
            response = requests.get(integration_api_url)
            response.raise_for_status()
            tenants_data = response.json()
        except requests.exceptions.RequestException as e:
            self.stderr.write(f'Error fetching data from integration API: {e}')
            return

        for tenant_data in tenants_data:
            tenant_id = tenant_data.get('tenant_id')
            try:
                tenant = Tenant.objects.get(id=tenant_id)
            except Tenant.DoesNotExist:
                self.stderr.write(f'Tenant with ID {tenant_id} not found. Skipping.')
                continue

            for transaction_data in tenant_data.get('ledger', []):
                Transaction.objects.update_or_create(
                    id=transaction_data.get('id'),
                    defaults={
                        'tenant': tenant,
                        'date': datetime.strptime(transaction_data.get('date'), '%Y-%m-%d').date(),
                        'description': transaction_data.get('description'),
                        'amount': transaction_data.get('amount'),
                    }
                )
        self.stdout.write('Successfully imported transaction data.') 