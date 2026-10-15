from django.urls import path
from .views import tenant_list, transaction_list, LedgerView

urlpatterns = [
    path('tenants/', tenant_list, name='tenant_list'),
    path('tenants/<int:id>/ledger/', LedgerView.as_view(), name='tenant_ledger'),
    path('transactions/', transaction_list, name='transaction_list'),
] 