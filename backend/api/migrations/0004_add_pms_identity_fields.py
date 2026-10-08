# Adds the fields needed to represent the external PMS data shape.
#
# Order matters: every field added here is nullable (or has a safe default) so
# the migration can apply to existing rows without a backfill step. The
# unique_together constraint over (tenant, external_id) is added in a later
# migration (0006) so that any pre-existing duplicate rows can be reconciled
# first (see 0005, the data migration).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0003_transaction"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenant",
            name="pms_tenant_id",
            field=models.IntegerField(db_index=True, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="transaction",
            name="external_id",
            field=models.IntegerField(db_index=True, default=None, null=True),
        ),
        migrations.AddField(
            model_name="transaction",
            name="type",
            field=models.CharField(blank=True, max_length=50, null=True),
        ),
        migrations.AddField(
            model_name="transaction",
            name="raw_payload",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
