"""WebSocket service — the realtime half of the chat backend.

Runs as its own deployment (port 8001) alongside the HTTP API project in
`chat_with_fastapi/` (port 8000). The two never call each other: they meet at
Redis, which carries every realtime event, and at MySQL, which this side reads
for auth and writes only for presence. See CLAUDE.md for the full contract.
"""
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI

from app.api.routes import ws
from app.core.config import settings
from app.core.presence import presence
from app.core.websocket import manager

if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        release=settings.APP_VERSION,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # This service holds the sockets, so it's the one that subscribes. The API
    # project only publishes, which needs no subscription.
    await manager.start()
    yield
    await manager.stop()
    await presence.close()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    openapi_url=f"{settings.API_PREFIX}/openapi.json",
    docs_url=f"{settings.API_PREFIX}/docs",
    redoc_url=f"{settings.API_PREFIX}/redoc",
    lifespan=lifespan,
)

# No CORS middleware: WebSocket handshakes are not subject to CORS, and this
# service serves no HTTP routes for a browser to fetch.
app.include_router(ws.router, prefix=settings.API_PREFIX)


@app.get("/health", include_in_schema=False)
async def health() -> dict:
    """Liveness only — deliberately does not touch MySQL or Redis.

    Sockets already open keep working through a database blip, so failing this
    check on one would make an orchestrator restart the process and drop every
    connection for no reason.
    """
    return {"status": "ok", "service": "ws", "version": settings.APP_VERSION}
