from jose import JWTError, jwt

from app.core.config import settings


def decode_access_token(token: str) -> str | None:
    """Verify a token issued by the HTTP API and return its subject (user id).

    Verification only — this service never issues tokens, so it needs no
    password hashing and no token creation. It does need SECRET_KEY and
    ALGORITHM to match the API's exactly.
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None
