"""Local file storage — naming, and the guards on delete()."""

from pathlib import Path

import pytest

from app.core.storage import LocalStorage


@pytest.fixture
def store(tmp_path: Path) -> LocalStorage:
    return LocalStorage(tmp_path, "/uploads")


async def test_save_writes_the_bytes_and_returns_a_public_url(store, tmp_path):
    url = await store.save(b"data", folder="avatars", ext="png")

    assert url.startswith("/uploads/avatars/")
    assert url.endswith(".png")
    assert (tmp_path / url.removeprefix("/uploads/")).read_bytes() == b"data"


async def test_save_never_reuses_a_name(store):
    """Names are random, so re-uploading can't overwrite someone else's file."""
    first = await store.save(b"a", folder="avatars", ext="png")
    second = await store.save(b"b", folder="avatars", ext="png")

    assert first != second


async def test_delete_removes_a_file_it_owns(store, tmp_path):
    url = await store.save(b"data", folder="avatars", ext="png")

    await store.delete(url)

    assert not (tmp_path / url.removeprefix("/uploads/")).exists()


async def test_delete_tolerates_a_missing_file(store):
    await store.delete("/uploads/avatars/gone.png")  # no raise


@pytest.mark.parametrize("url", [None, "", "https://bucket.s3.amazonaws.com/avatars/x.png"])
async def test_delete_ignores_urls_it_does_not_own(store, url):
    """After the S3 migration old rows still hold absolute URLs — not ours to unlink."""
    await store.delete(url)  # no raise, nothing touched


async def test_delete_refuses_to_escape_the_root(store, tmp_path):
    outside = tmp_path.parent / "secret.txt"
    outside.write_text("keep me")

    await store.delete(f"/uploads/../{outside.name}")

    assert outside.exists()
