from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Chat Realtime WebSocket Service"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v1"

    # Database — read-mostly: this service verifies tokens and membership, and
    # writes only the presence columns on `users`. Schema and migrations belong
    # to the HTTP API project.
    DATABASE_URL: str

    # Redis — carries every realtime event between the two services
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT — verification only. This service never issues tokens; SECRET_KEY and
    # ALGORITHM must match the HTTP API's or every socket is rejected with 4001.
    SECRET_KEY: str = "change-this-secret-key-in-production"
    ALGORITHM: str = "HS256"

    # Sentry — unset (None) disables it entirely, same convention as the API
    SENTRY_DSN: str | None = None
    SENTRY_ENVIRONMENT: str = "development"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
