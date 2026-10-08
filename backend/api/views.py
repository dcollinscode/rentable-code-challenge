from decimal import Decimal

from django.db.models import Case, When, F, DecimalField, Sum
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.generics import GenericAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework import status
from api.models import Tenant, Transaction
from api.serializers import (
    TenantSerializer,
    TransactionSerializer,
    LedgerSerializer,
    LedgerTransactionSerializer,
)

# Create your views here.

@api_view(['GET'])
def welcome_message(request):
    """
    A simple view to test the API.
    """
    return Response({'message': 'Welcome to the Rentable Code Challenge!'})

@api_view(['GET'])
def tenant_list(request):
    """
    Returns a list of all tenants.
    """
    tenants = Tenant.objects.all()
    serializer = TenantSerializer(tenants, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def transaction_list(request):
    """
    Returns a list of transactions, optionally filtered by tenant.
    """
    transactions = Transaction.objects.all()
    serializer = TransactionSerializer(transactions, many=True)
    return Response(serializer.data) 

class LedgerPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = None

class LedgerView(GenericAPIView):
    """
    Returns a tenant's transactions (paginated, date desc then external_id desc)
    and the tenant's computed balance. The balance is summed in SQL so no
    per-row work happens in Python.
    """
    serializer_class = LedgerSerializer
    pagination_class = LedgerPagination
    queryset = Transaction.objects.select_related('tenant')

    def get_queryset(self):
        # select_related pulls the tenant in the same query that loads the
        # transactions, avoiding an N+1 on the tenant lookup.
        return Transaction.objects.select_related('tenant').filter(
            tenant_id=self.kwargs['id']
        ).order_by('-date', '-external_id')

    def get(self, request, id):
        # 404s cleanly here if the tenant does not exist.
        tenant = get_object_or_404(Tenant, pk=id)

        balance = tenant.transactions.aggregate(
            total=Sum(
                Case(
                    When(type='charge', then=F('amount')),
                    When(type='payment', then=-F('amount')),
                    default=F('amount'),
                    output_field=DecimalField(max_digits=12, decimal_places=2),
                )
            )
        )['total'] or Decimal('0.00')

        queryset = self.get_queryset()
        page = self.paginate_queryset(queryset)
        transactions = page if page is not None else queryset

        payload = LedgerSerializer(
            {
                'tenant': tenant,
                'balance': balance,
                'transaction_count': queryset.count(),
                'transactions': transactions,
            }
        ).data

        return Response(
            {
                'count': queryset.count(),
                'next': self.paginator.get_next_link(),
                'previous': self.paginator.get_previous_link(),
                'tenant': payload['tenant'],
                'balance': payload['balance'],
                'transaction_count': payload['transaction_count'],
                'results': payload['transactions'],
            }
        )

