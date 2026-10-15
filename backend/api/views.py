from decimal import Decimal

from django.db.models import Case, When, F, DecimalField, Sum
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.generics import GenericAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework import status
from api.models import Tenant, Transaction
from api.pagination import RelativePageNumberPagination
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
    Returns a paginated list of tenants.

    Paginated with DRF's standard envelope:
    {count, next, previous, results}. The ordering is always deterministic so a
    tenant never appears twice or is skipped as the client walks the pages.
    Out-of-range pages return 404 (DRF default).

    Ordering is controlled by the optional ``ordering`` query param, restricted
    to an allowlist:

    * ``id`` (default) — ascending primary key, i.e. the raw database order.
    * ``name`` — name (A–Z), with ``id`` as a tiebreaker.
    * ``-name`` — name (Z–A), with ``id`` as a tiebreaker.

    An absent or unsupported value falls back to the default (``id``) rather
    than 400ing: the frontend may send a stale value, and silently using the
    default is friendlier than a hard error for what is only a presentational
    choice.

    The paginator returns *relative* next/previous links (e.g.
    "/api/tenants/?page=2") so the client resolves them against its own origin
    and avoids the dev-mode cross-origin (CORS) trap — see pagination.py.
    """
    tenants = _ordered_tenants(request)
    paginator = RelativePageNumberPagination()
    page = paginator.paginate_queryset(tenants, request, view=tenant_list)
    serializer = TenantSerializer(page, many=True)
    return paginator.get_paginated_response(serializer.data)


# The ``ordering`` values the client may send, mapped to the ``order_by``
# expression actually used. An explicit allowlist — user input is validated
# against it and never interpolated into ``.order_by()`` directly, which would
# be an injection vector.
_TENANT_ORDERING_FIELDS = {
    'id': 'id',
    'name': 'name',
    '-name': '-name',
}

# Default ordering: the raw database order (primary key ascending).
_TENANT_DEFAULT_ORDERING = 'id'


def _ordered_tenants(request):
    """
    Build the tenant queryset for a list request, ordered per the optional
    ``ordering`` query param (see :func:`tenant_list`).

    The name orderings keep ``id`` as a tiebreaker so that equal-name rows stay
    stably ordered across pages.
    """
    ordering = _TENANT_ORDERING_FIELDS.get(
        request.query_params.get('ordering'), _TENANT_DEFAULT_ORDERING
    )

    if ordering in ('name', '-name'):
        return Tenant.objects.all().order_by(ordering, 'id')
    return Tenant.objects.all().order_by(ordering)


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


