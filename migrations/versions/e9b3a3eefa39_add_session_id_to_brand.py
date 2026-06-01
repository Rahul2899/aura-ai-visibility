"""add session_id to brand

Revision ID: e9b3a3eefa39
Revises: 8eee1f0fd62d
Create Date: 2026-05-31 17:31:57.513552

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9b3a3eefa39'
down_revision: Union[str, None] = '8eee1f0fd62d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('brands', sa.Column('session_id', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('brands', 'session_id')
