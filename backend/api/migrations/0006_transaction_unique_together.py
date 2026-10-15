# Enforces the natural key for PMS-imported transactions.
#
# This runs after:
#   * 0004, which added the nullable external_id column, and
#   * 0005, which removed any pre-existing duplicate (tenant, external_id) rows.
#
# We also tighten external_id to NOT NULL now that the column exists and the
# application always populates it for imported rows. (Note: SQL treats NULLs as
# distinct in unique constraints, so the constraint alone would silently permit
# many rows with a NULL external_id; making the column non-null closes that
# loophole.)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0005_dedupe_transactions"),
    ]

    operations = [
        migrations.AlterField(
            model_name="transaction",
            name="external_id",
            field=models.IntegerField(db_index=True),
        ),
        migrations.AlterUniqueTogether(
            name="transaction",
            unique_together={("tenant", "external_id")},
        ),
    ]
