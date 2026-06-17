from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.conversation import Conversation, ConversationType
from app.models.conversation_member import ConversationMember, ConversationMemberRole
from app.models.user import User
from app.schemas.conversation import ConversationCreate


class ConversationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_list_by_id(self, user_id: int) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
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