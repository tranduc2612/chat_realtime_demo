"""Upload validation — the checks that stop a non-image reaching disk."""

import io

import pytest
from fastapi import UploadFile

from app.utils.images import ImageValidationError, read_image_upload, sniff_image_type

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32
WEBP = b"RIFF" + b"\x24\x00\x00\x00" + b"WEBP" + b"\x00" * 32


def upload(data: bytes, content_type: str = "image/png", filename: str = "a.png") -> UploadFile:
    return UploadFile(
        file=io.BytesIO(data),
        filename=filename,
        headers={"content-type": content_type},
        size=len(data),
    )


@pytest.mark.parametrize(
    "data,expected",
    [(PNG, "png"), (JPEG, "jpg"), (GIF, "gif"), (WEBP, "webp")],
)
def test_sniff_known_formats(data, expected):
    assert sniff_image_type(data[:12]) == expected


@pytest.mark.parametrize(
    "data",
    [
        b"<svg xmlns='http://www.w3.org/2000/svg'>",  # scriptable, not in the allowlist
        b"<?php system($_GET['c']); ?>",
        b"RIFF\x24\x00\x00\x00WAVE",  # RIFF container, but audio
        b"",
    ],
)
def test_sniff_rejects_non_images(data):
    assert sniff_image_type(data[:12]) is None


async def test_read_accepts_a_real_png():
    data, ext = await read_image_upload(upload(PNG), max_bytes=1024)

    assert data == PNG
    assert ext == "png"


async def test_read_rejects_disallowed_content_type():
    with pytest.raises(ImageValidationError) as exc:
        await read_image_upload(upload(PNG, content_type="application/pdf", filename="a.pdf"), 1024)

    assert exc.value.key == "invalid_image_type"


async def test_read_rejects_a_script_wearing_an_image_content_type():
    """The check that matters: content-type and filename both lie, bytes don't."""
    payload = b"<?php system($_GET['c']); ?>"

    with pytest.raises(ImageValidationError) as exc:
        await read_image_upload(upload(payload, content_type="image/png", filename="pwn.png"), 1024)

    assert exc.value.key == "invalid_image_content"


async def test_read_rejects_oversized_file_from_declared_size():
    with pytest.raises(ImageValidationError) as exc:
        await read_image_upload(upload(PNG), max_bytes=4)

    assert exc.value.key == "image_too_large"


async def test_read_rejects_oversized_file_when_size_is_unknown():
    """A client can omit/understate Content-Length, so the stream is capped too."""
    file = UploadFile(file=io.BytesIO(PNG), filename="a.png", headers={"content-type": "image/png"})
    assert file.size is None

    with pytest.raises(ImageValidationError) as exc:
        await read_image_upload(file, max_bytes=4)

    assert exc.value.key == "image_too_large"


async def test_read_rejects_empty_file():
    with pytest.raises(ImageValidationError) as exc:
        await read_image_upload(upload(b""), 1024)

    assert exc.value.key == "empty_image"


async def test_extension_comes_from_the_bytes_not_the_filename():
    """A JPEG uploaded as `evil.png` is stored as .jpg — the name is never trusted."""
    _, ext = await read_image_upload(upload(JPEG, content_type="image/jpeg", filename="evil.png"), 1024)

    assert ext == "jpg"
