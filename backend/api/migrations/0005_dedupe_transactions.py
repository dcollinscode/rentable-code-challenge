# Data migration: reconcile rows that would violate the (tenant, external_id)
# unique_together constraint added in 0006.
#
# DB is assumed fresh for the challenge (post_create.sh recreates db.sqlite3
# from scratch), so in practice there is nothing to clean up here. This step is
# still included so the migration chain is safe on a database that already has
# transaction rows predating external_id:
#
#   * Rows with external_id IS NULL are left untouched - a NULL external_id
#     does not participate in a unique_together constraint under SQL semantics
#     (NULLs compare as distinct), so they cannot cause a violation.
#   * For each (tenant, external_id) group with more than one row, keep the
#     most recently inserted row (highest PK) and delete the older duplicates.

from django.db import migrations
from django.db.models import Count, Max


def dedupe_transactions(apps, schema_editor):
    Transaction = apps.get_model("api", "Transaction")

    duplicates = (
        Transaction.objects.filter(external_id__isnull=False)
        .values("tenant_id", "external_id")
        .annotate(count=Count("id"), keep_id=Max("id"))
        .filter(count__gt=1)
    )

    for dup in duplicates:
        Transaction.objects.filter(
            tenant_id=dup["tenant_id"],
            external_id=dup["external_id"],
        ).exclude(id=dup["keep_id"]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0004_add_pms_identity_fields"),
    ]

    operations = [
        migrations.RunPython(dedupe_transactions, migrations.RunPython.noop),
    ]
