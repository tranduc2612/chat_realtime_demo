from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI, Depends, HTTPException
from app.api.main import api_router
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.presence import presence
from app.core.events import events
from app.core.storage import storage

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
    # Nothing to start: sockets and the pub/sub listener live in the WebSocket
    # service (chat_with_fastapi_ws). This side only publishes.
    yield
    await events.close()
    await presence.close()


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

# User uploads (avatars). Served straight off disk at UPLOAD_URL_PREFIX —
# outside API_PREFIX, since these are files, not API resources, and the URL
# is stored in the database. Only formats validated by magic bytes ever land
# here (see app/utils/images.py), so there is no SVG/HTML to execute in the
# app's origin. When this moves to S3 the mount goes away and stored URLs
# become absolute; the frontend already handles both (resolveMediaUrl).
storage.ensure_root()
app.mount(
    settings.UPLOAD_URL_PREFIX,
    StaticFiles(directory=settings.UPLOAD_DIR),
    name="uploads",
)

app.include_router(api_router, prefix=settings.API_PREFIX)