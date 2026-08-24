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

    # Uploads — user-supplied files (avatars today) land on local disk under
    # UPLOAD_DIR and are served back at UPLOAD_URL_PREFIX by StaticFiles. The
    # directory is a shared named volume in Docker, because the replica that
    # accepts an upload is rarely the one nginx sends the next GET to. Both
    # values exist as settings so the eventual move to S3 is a config change
    # plus a new Storage class (see app/core/storage.py), not a code hunt.
    UPLOAD_DIR: str = "uploads"
    UPLOAD_URL_PREFIX: str = "/uploads"
    MAX_AVATAR_BYTES: int = 5 * 1024 * 1024

    # CORS
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:5173",
    ]

    # Sentry — unset (None) disables it entirely, so dev stays quiet by
    # default; set SENTRY_DSN in .env.staging/.env.prod to turn it on there.
    SENTRY_DSN: str | None = None
    SENTRY_ENVIRONMENT: str = "development"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
