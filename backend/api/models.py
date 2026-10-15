from django.db import models

# Create your models here.
# The candidate will define the Transaction model in this file.

class Tenant(models.Model):
    name = models.CharField(max_length=255)
    unit = models.CharField(max_length=50, blank=True, null=True)
    # The tenant's identifier in the external PMS, kept separate from the
    # Django auto PK so imports can join on a stable business key rather than
    # relying on local row ordering. Nullable for now so existing rows and
    # manual creation still work; can be tightened once all rows are backfilled.
    pms_tenant_id = models.IntegerField(unique=True, db_index=True, null=True)

    def __str__(self):
        return self.name

class Transaction(models.Model):
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='transactions')
    date = models.DateField()
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    # The ledger entry id as supplied by the PMS. Stored separately from the
    # Django auto PK so re-imports upsert on the PMS identity instead of
    # overwriting local PKs. (PMS may send this as a string; numeric here.)
    external_id = models.IntegerField(db_index=True)
    # The PMS transaction kind, e.g. "charge" or "payment". Needed to interpret
    # transaction direction when computing a balance.
    type = models.CharField(max_length=50, blank=True, null=True)
    # The raw ledger entry from the PMS, retained verbatim for auditing and to
    # support re-processing when the mapped schema evolves.
    raw_payload = models.JSONField(blank=True, null=True)

    class Meta:
        unique_together = [("tenant", "external_id")]

    def __str__(self):
        return f"{self.date} - {self.description} ({self.amount})" 