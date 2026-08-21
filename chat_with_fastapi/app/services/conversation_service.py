from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.conversation import Conversation, ConversationType
from app.models.conversation_member import ConversationMember, ConversationMemberRole
from app.models.user import User
from app.schemas.conversation import ConversationCreate


class ConversationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_direct(self, user_a: str, user_b: str) -> Conversation | None:
        """Return existing direct conversation between two users, or None."""
        a_convs = select(ConversationMember.conversation_id).where(
            ConversationMember.user_id == user_a,
            ConversationMember.left_at.is_(None),
        )
        b_convs = select(ConversationMember.conversation_id).where(
            ConversationMember.user_id == user_b,
            ConversationMember.left_at.is_(None),
        )
        result = await self.db.execute(
            select(Conversation).where(
                Conversation.type == ConversationType.DIRECT,
                Conversation.id.in_(a_convs),
                Conversation.id.in_(b_convs),
            )
        )
        return result.scalar_one_or_none()

    async def get_contact_ids(self, user_id: str) -> list[str]:
        """Everyone who shares a conversation with this user, excluding themselves.

        These are exactly the people who should hear about their presence
        changing — broadcasting to every account would leak who is online to
        strangers, and cost a Redis publish per user on the whole instance.
        """
        my_conv_ids = select(ConversationMember.conversation_id).where(
            ConversationMember.user_id == user_id,
            ConversationMember.left_at.is_(None),
        )
        result = await self.db.execute(
            select(ConversationMember.user_id)
            .where(
                ConversationMember.conversation_id.in_(my_conv_ids),
                ConversationMember.user_id != user_id,
                ConversationMember.left_at.is_(None),
            )
            .distinct()
        )
        return list(result.scalars().all())

    async def get_list_for_user(self, user_id: str) -> list[Conversation]:
        member_conv_ids = select(ConversationMember.conversation_id).where(
            ConversationMember.user_id == user_id,
            ConversationMember.left_at.is_(None),
        )
        result = await self.db.execute(
            select(Conversation)
            .where(Conversation.id.in_(member_conv_ids))
            .options(selectinload(Conversation.members).selectinload(ConversationMember.user))
            .order_by(Conversation.updated_at.desc())
        )
        return list(result.scalars().all())

    async def get_with_members(self, conversation_id: str) -> Conversation | None:
        result = await self.db.execute(
            select(Conversation)
            .where(Conversation.id == conversation_id)
            .options(selectinload(Conversation.members).selectinload(ConversationMember.user))
        )
        return result.scalar_one_or_none()
    
    async def create(self, data: ConversationCreate) -> Conversation:
        if data.type == ConversationType.DIRECT and len(data.user_ids) == 1:
            conversation = Conversation(
                type=data.type,
                avatar_url=data.avatar_url,
                name=data.name,
                created_by_id= data.created_by_id,
            )

            self.db.add(conversation)

            await self.db.flush()
            
            yourself = ConversationMember(
                conversation_id=conversation.id,
                user_id=data.created_by_id,
                role=ConversationMemberRole.OWNER
            )

            self.db.add(yourself)

            member = ConversationMember(
                conversation_id=conversation.id,
                user_id=data.user_ids[0],
                role=ConversationMemberRole.MEMBER
            )

            self.db.add(member)

            await self.db.commit()

            await self.db.refresh(conversation)

            return conversation
        
        if data.type == ConversationType.GROUP and len(data.user_ids) > 1:
            conversation = Conversation(
                type=data.type,
                avatar_url=data.avatar_url,
                name=data.name,
                created_by_id=data.created_by_id,
            )

            self.db.add(conversation)

            await self.db.flush()
            
            yourself = ConversationMember(
                conversation_id=conversation.id,
                user_id=data.created_by_id,
                role=ConversationMemberRole.OWNER
            )

            self.db.add(yourself)

            for user_id in data.user_ids:
                member = ConversationMember(
                    conversation_id=conversation.id,
                    user_id=user_id,
                    role=ConversationMemberRole.MEMBER
                )
                self.db.add(member)

            await self.db.commit()

            await self.db.refresh(conversation)

            return conversation
        
        raise ValueError("Invalid conversation type or user IDs")

    async def add_members(self, conversation_id: str, user_ids: list[str], requester_id: str) -> Conversation:
        # Verify conversation exists and requester is a member
        result = await self.db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == requester_id,
                ConversationMember.left_at.is_(None),
            )
        )
        if not result.scalar_one_or_none():
            raise ValueError("Not a member of this conversation")

        conv_result = await self.db.execute(
            select(Conversation).where(Conversation.id == conversation_id)
        )
        conv = conv_result.scalar_one_or_none()
        if not conv or conv.type != ConversationType.GROUP:
            raise ValueError("Only group conversations support adding members")

        for user_id in user_ids:
            # Check for existing membership row (may have left)
            existing = await self.db.execute(
                select(ConversationMember).where(
                    ConversationMember.conversation_id == conversation_id,
                    ConversationMember.user_id == user_id,
                )
            )
            row = existing.scalar_one_or_none()
            if row:
                # Re-activate if they left
                if row.left_at is not None:
                    row.left_at = None
                    row.role = ConversationMemberRole.MEMBER
            else:
                self.db.add(ConversationMember(
                    conversation_id=conversation_id,
                    user_id=user_id,
                    role=ConversationMemberRole.MEMBER,
                ))

        await self.db.commit()
        return await self.get_with_members(conversation_id)