"""baseline

Revision ID: a9cd3d23d401
Revises:
Create Date: 2026-10-03 21:46:39.017946
"""

from collections.abc import Sequence

revision: str = "a9cd3d23d401"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
