import re
from datetime import datetime, timezone


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def paginate(skip: int, limit: int, total: int) -> dict:
    return {
        "skip": skip,
        "limit": limit,
        "total": total,
        "has_next": skip + limit < total,
        "has_prev": skip > 0,
    }
