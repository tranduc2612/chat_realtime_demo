"""Validation for user-uploaded images.

Three independent checks, because each one alone is trivially bypassable:

1. `content_type` — what the browser claims. Cheap, and rejects the obvious
   `.pdf` before a single byte is read.
2. Size — enforced *while streaming*, so a 2 GB "avatar" is abandoned after
   the first few megabytes instead of being buffered in full and then
   rejected.
3. Magic bytes — what the file actually is. This is the check that matters:
   a `.png` that is really a PHP script or an HTML page (stored XSS, if it
   were ever served back inline) fails here, and the stored extension comes
   from the sniffed type rather than from the attacker-supplied filename.

Deliberately dependency-free — sniffing a handful of signatures is a dozen
lines, where Pillow would add a native-dependency image decoder to the API
image for the same answer. (If thumbnails or re-encoding are ever wanted,
that's the moment to add it.)
"""

from fastapi import UploadFile

# Sniffed type -> the extension we store it under. Also the allowlist: a
# format that isn't here has no entry and is rejected.
IMAGE_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "jpg"),                # JPEG
    (b"\x89PNG\r\n\x1a\n", "png"),           # PNG
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
]

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
}

CHUNK_SIZE = 64 * 1024

# 12 bytes covers the longest check (WebP's "RIFF....WEBP")
_SNIFF_BYTES = 12


class ImageValidationError(Exception):
    """Rejected upload. `key` is a translator key, so routes can localize it."""

    def __init__(self, key: str) -> None:
        super().__init__(key)
        self.key = key


def sniff_image_type(header: bytes) -> str | None:
    """Return the file extension for the image `header` starts with, or None."""
    for signature, ext in IMAGE_SIGNATURES:
        if header.startswith(signature):
            return ext
    # WebP is a RIFF container: "RIFF" + 4 size bytes + "WEBP"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "webp"
    return None


async def read_image_upload(file: UploadFile, max_bytes: int) -> tuple[bytes, str]:
    """Validate `file` as an image and return its bytes plus a safe extension.

    Raises ImageValidationError; never raises on a merely odd-looking file.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise ImageValidationError("invalid_image_type")

    # Starlette fills this in from the multipart body when it can; it's a hint
    # that lets an oversized upload fail before we read any of it.
    if file.size is not None and file.size > max_bytes:
        raise ImageValidationError("image_too_large")

    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(CHUNK_SIZE):
        total += len(chunk)
        if total > max_bytes:
            raise ImageValidationError("image_too_large")
        chunks.append(chunk)

    data = b"".join(chunks)
    if not data:
        raise ImageValidationError("empty_image")

    ext = sniff_image_type(data[:_SNIFF_BYTES])
    if ext is None:
        # Claimed an image content-type but the bytes say otherwise.
        raise ImageValidationError("invalid_image_content")

    return data, ext
