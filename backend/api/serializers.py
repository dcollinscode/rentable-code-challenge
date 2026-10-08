from rest_framework import serializers
from api.models import Tenant, Transaction

class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = '__all__'

class TransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'tenant', 'date', 'description', 'amount'] 

class LedgerTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Transaction
        fields = ['id', 'external_id', 'date', 'description', 'amount', 'type']

class LedgerTenantSerializer(serializers.ModelSerializer):
    tenant_id = serializers.IntegerField(source='pms_tenant_id', read_only=True)

    class Meta:
        model = Tenant
        fields = ['id', 'tenant_id', 'name', 'unit']

class LedgerSerializer(serializers.Serializer):
    tenant = LedgerTenantSerializer()
    balance = serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=True
    )
    transaction_count = serializers.IntegerField()
    transactions = LedgerTransactionSerializer(many=True)
