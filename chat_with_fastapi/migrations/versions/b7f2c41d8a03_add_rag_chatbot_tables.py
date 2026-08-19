"""add rag chatbot tables

Revision ID: b7f2c41d8a03
Revises: e90cd17239b7
Create Date: 2026-08-18 10:12:44.108927

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7f2c41d8a03'
down_revision: Union[str, Sequence[str], None] = 'e90cd17239b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('documents',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('mime_type', sa.String(length=127), nullable=True),
    sa.Column('file_size', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('PENDING', 'PROCESSING', 'READY', 'FAILED', name='documentstatus'), nullable=False),
    sa.Column('chunk_count', sa.Integer(), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('uploaded_by_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_documents_created_at'), 'documents', ['created_at'], unique=False)
    op.create_index(op.f('ix_documents_status'), 'documents', ['status'], unique=False)
    op.create_index(op.f('ix_documents_uploaded_by_id'), 'documents', ['uploaded_by_id'], unique=False)

    op.create_table('bot_conversations',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bot_conversations_user_id'), 'bot_conversations', ['user_id'], unique=False)
    op.create_index('ix_bot_conversations_user_updated', 'bot_conversations', ['user_id', 'updated_at'], unique=False)

    op.create_table('bot_messages',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('bot_conversation_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.Enum('USER', 'ASSISTANT', name='botmessagerole'), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('citations', sa.JSON(), nullable=True),
    sa.Column('model', sa.String(length=100), nullable=True),
    sa.Column('prompt_tokens', sa.Integer(), nullable=True),
    sa.Column('completion_tokens', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['bot_conversation_id'], ['bot_conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bot_messages_bot_conversation_id'), 'bot_messages', ['bot_conversation_id'], unique=False)
    op.create_index(op.f('ix_bot_messages_created_at'), 'bot_messages', ['created_at'], unique=False)
    op.create_index('ix_bot_messages_conversation_created', 'bot_messages', ['bot_conversation_id', 'created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_bot_messages_conversation_created', table_name='bot_messages')
    op.drop_index(op.f('ix_bot_messages_created_at'), table_name='bot_messages')
    op.drop_index(op.f('ix_bot_messages_bot_conversation_id'), table_name='bot_messages')
    op.drop_table('bot_messages')

    op.drop_index('ix_bot_conversations_user_updated', table_name='bot_conversations')
    op.drop_index(op.f('ix_bot_conversations_user_id'), table_name='bot_conversations')
    op.drop_table('bot_conversations')

    op.drop_index(op.f('ix_documents_uploaded_by_id'), table_name='documents')
    op.drop_index(op.f('ix_documents_status'), table_name='documents')
    op.drop_index(op.f('ix_documents_created_at'), table_name='documents')
    op.drop_table('documents')
