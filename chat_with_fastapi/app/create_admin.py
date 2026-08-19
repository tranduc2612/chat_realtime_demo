"""Create or promote an admin user.

Uploading internal documents is admin-only, but public registration always
creates a plain `user` — so a fresh database has nobody who can seed the
knowledge base. This is the bootstrap:

    python -m app.create_admin --email me@corp.com --username me --password 's3cret!!'

Re-running it against an existing username or email promotes that account to
admin instead of failing, so it doubles as "make this person an admin".
"""
import argparse
import asyncio
import logging

from sqlalchemy import or_, select

from app.core.database import AsyncSessionLocal, engine
from app.core.security import hash_password
from app.models.user import User, UserRole

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def create_admin(email: str, username: str, password: str, full_name: str | None) -> None:
    try:
        await _upsert_admin(email, username, password, full_name)
    finally:
        # Without this the aiomysql pool still holds open connections when
        # asyncio.run() closes the loop, and the script exits with a noisy
        # "Event loop is closed" traceback despite having succeeded.
        await engine.dispose()


async def _upsert_admin(email: str, username: str, password: str, full_name: str | None) -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User).where(or_(User.email == email, User.username == username))
        )
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                email=email,
                username=username,
                full_name=full_name or username,
                hashed_password=hash_password(password),
                role=UserRole.ADMIN,
                is_active=True,
                is_verified=True,
            )
            session.add(user)
            action = "Created admin"
        else:
            user.role = UserRole.ADMIN
            user.is_active = True
            session.add(user)
            action = "Promoted existing user to admin"

        await session.commit()
        logger.info("%s: %s (%s)", action, user.username, user.email)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or promote an admin user")
    parser.add_argument("--email", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument(
        "--password",
        required=True,
        help="Only used when creating a new account; ignored when promoting an existing one.",
    )
    parser.add_argument("--full-name", default=None)
    args = parser.parse_args()

    if len(args.password) < 8:
        parser.error("password must be at least 8 characters")

    asyncio.run(create_admin(args.email, args.username, args.password, args.full_name))


if __name__ == "__main__":
    main()
