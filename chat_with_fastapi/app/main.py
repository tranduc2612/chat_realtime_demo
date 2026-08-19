from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Depends, HTTPException
from app.api.main import api_router
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.llm import close_openai
from app.core.websocket import manager

# Gated on SENTRY_DSN being set (defaults to None/unset) — dev stays silent
# unless you explicitly opt it in via .env; staging/prod turn this on via
# .env.staging/.env.prod. `release` ties Sentry events back to the same
# VERSION-driven APP_VERSION used for image tags and Swagger's version field.
if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        release=settings.APP_VERSION,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await manager.start()
    yield
    await manager.stop()
    # No-op unless the RAG chatbot was actually used — the OpenAI client is
    # created lazily on first request, not at startup.
    await close_openai()


app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        openapi_url=f"{settings.API_PREFIX}/openapi.json",
        docs_url=f"{settings.API_PREFIX}/docs",
        redoc_url=f"{settings.API_PREFIX}/redoc",
        lifespan=lifespan,
    )

app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_PREFIX)