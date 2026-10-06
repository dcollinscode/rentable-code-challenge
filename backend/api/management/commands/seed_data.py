from django.core.management.base import BaseCommand
from api.models import Tenant

class Command(BaseCommand):
    help = 'Seeds the database with initial data (e.g., tenants).'

    def handle(self, *args, **options):
        self.stdout.write('Starting to seed tenant data.')
        tenants_data = [
            {'name': 'Alice Wonderland', 'unit': 'A101'},
            {'name': 'Bob The Builder', 'unit': 'B202'},
            {'name': 'Charlie Chaplin', 'unit': 'C303'},
        ]

        for tenant_data in tenants_data:
            tenant, created = Tenant.objects.get_or_create(
                name=tenant_data['name'],
                defaults={'unit': tenant_data['unit']}
            )
            if not created and tenant.unit != tenant_data['unit']:
                tenant.unit = tenant_data['unit']
                tenant.save()
        
        self.stdout.write('Successfully seeded tenant data.')