"""add audit limits table

Revision ID: f1a2b3c4d5e6
Revises: 5de19647c4ee
Create Date: 2026-05-31 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = '5de19647c4ee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'audit_limits',
        sa.Column('ip_address', sa.String(100), primary_key=True),
        sa.Column('audit_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_audit_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('audit_limits')
