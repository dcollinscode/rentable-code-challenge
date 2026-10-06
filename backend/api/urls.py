from django.urls import path
from .views import tenant_list, transaction_list

urlpatterns = [
    path('tenants/', tenant_list, name='tenant_list'),
    path('transactions/', transaction_list, name='transaction_list'),
] 