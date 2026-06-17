from fastapi import APIRouter

from app.api.routes import conversation, user, auth, message

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(user.router)
api_router.include_router(conversation.router)
api_router.include_router(message.router)
