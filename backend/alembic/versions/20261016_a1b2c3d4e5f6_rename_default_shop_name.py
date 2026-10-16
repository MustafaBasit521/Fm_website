"""rename the seeded shop name to Bundle of Loops

Only rows that still hold the original seeded default are changed, so a name the owner has
already set in the admin settings is never overwritten.

Revision ID: a1b2c3d4e5f6
Revises: 540a35727252
Create Date: 2026-10-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "540a35727252"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE business_settings SET business_name = 'Bundle of Loops' "
        "WHERE business_name = 'Crochet Shop'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE business_settings SET business_name = 'Crochet Shop' "
        "WHERE business_name = 'Bundle of Loops'"
    )
