from pydantic_settings import BaseSettings,SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    # App
    APP_NAME: str = "FastAPI Boilerplate"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v1"

    # Database
    DATABASE_URL: str
    DATABASE_SYNC_URL: str

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    SECRET_KEY: str = "change-this-secret-key-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 3000

    # CORS — set per environment via the ALLOWED_ORIGINS env var, as a JSON
    # array (e.g. ALLOWED_ORIGINS=["http://localhost:5173"]). Defaults to
    # empty: no browser origin is allowed until an environment declares one.
    ALLOWED_ORIGINS: list[str] = []

    # Sentry — unset (None) disables it entirely, so dev stays quiet by
    # default; set SENTRY_DSN in .env.staging/.env.prod to turn it on there.
    SENTRY_DSN: str | None = None
    SENTRY_ENVIRONMENT: str = "development"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    # OpenAI — unset (None) disables the RAG chatbot the same way SENTRY_DSN
    # gates Sentry: /api/v1/bot/* and /api/v1/documents/* return 503 instead of
    # crashing at import time, so the rest of the app runs fine without a key.
    OPENAI_API_KEY: str | None = None
    OPENAI_CHAT_MODEL: str = "gpt-4o-mini"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    # text-embedding-3-* accept a shortened output dimension; 1536 is the
    # model's native size. Changing this invalidates every stored vector —
    # Chroma collections are fixed-width, so re-ingest all documents after.
    OPENAI_EMBEDDING_DIMENSIONS: int = 1536
    OPENAI_TIMEOUT_SECONDS: float = 60.0

    # ChromaDB — runs as its own service (see docker-compose*.yml). Not an
    # embedded PersistentClient on purpose: the backend runs 3 replicas, and
    # three processes writing one SQLite file would corrupt it.
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8000
    CHROMA_COLLECTION: str = "internal_docs"

    # RAG retrieval/ingestion tuning
    RAG_CHUNK_SIZE: int = 1000          # characters per chunk
    RAG_CHUNK_OVERLAP: int = 150        # characters shared between neighbours
    RAG_TOP_K: int = 5                  # chunks retrieved per question
    # Cosine distance ceiling (Chroma returns 0 = identical, 2 = opposite).
    # Chunks above this are dropped, so an unrelated question retrieves
    # nothing and the bot answers "not covered by the internal documents"
    # instead of padding the prompt with noise.
    RAG_MAX_DISTANCE: float = 0.75
    RAG_MAX_HISTORY: int = 10           # prior bot messages replayed as context
    RAG_MAX_UPLOAD_MB: int = 10

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
