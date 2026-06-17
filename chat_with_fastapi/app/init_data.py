import asyncio
import logging

from app.core.database import init_db
import app.models

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    logger.info("Creating database tables...")

    await init_db()

    logger.info("Database initialized successfully")


if __name__ == "__main__":
    asyncio.run(main())