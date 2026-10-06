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