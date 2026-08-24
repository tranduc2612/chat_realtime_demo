"""File storage — local disk today, S3 tomorrow.

Everything that writes user-uploaded files goes through the `storage`
singleton below, and nothing else in the codebase knows where the bytes
actually land: callers hand over bytes and get back a *public URL* they store
in the database. Swapping to S3 means adding an `S3Storage` with the same two
methods and pointing `storage` at it — no service, route or migration
changes, and rows written by the local backend keep working because
`delete()` ignores URLs it doesn't own (an absolute `https://...` S3 URL is
simply not this store's to remove).
"""

from pathlib import Path
from uuid import uuid4

from anyio import to_thread

from app.core.config import settings


class LocalStorage:
    """Writes under `root` and serves the files back through `url_prefix`.

    `root` is mounted by `main.py` as StaticFiles at `url_prefix`, so the URL
    this returns is directly fetchable. In Docker it is a named volume shared
    by every API replica — nginx round-robins requests, so the replica that
    serves an avatar is almost never the one that stored it.
    """

    def __init__(self, root: str | Path, url_prefix: str) -> None:
        self.root = Path(root).resolve()
        self.url_prefix = "/" + url_prefix.strip("/")

    def ensure_root(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    async def save(self, data: bytes, *, folder: str, ext: str) -> str:
        """Store `data` under `folder` with a random name; return its URL."""
        name = f"{uuid4().hex}.{ext.lstrip('.')}"
        directory = self.root / folder
        target = directory / name

        def _write() -> None:
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)

        await to_thread.run_sync(_write)
        return f"{self.url_prefix}/{folder}/{name}"

    def _path_for(self, url: str) -> Path | None:
        """Resolve a public URL back to a path, or None if not ours.

        Returns None for anything that isn't a path under `url_prefix` — an
        absolute URL from a future S3 backend, or a crafted `../..` value —
        so a stale `avatar_url` can never delete a file outside the store.
        """
        prefix = self.url_prefix + "/"
        if not url.startswith(prefix):
            return None
        path = (self.root / url[len(prefix):]).resolve()
        if not path.is_relative_to(self.root):
            return None
        return path

    async def delete(self, url: str | None) -> None:
        """Best-effort removal — a missing file is not an error."""
        if not url:
            return
        path = self._path_for(url)
        if path is None:
            return
        await to_thread.run_sync(lambda: path.unlink(missing_ok=True))


# The one storage backend the app uses. Point this at an S3Storage (same
# save/delete signatures) to migrate; nothing else changes.
storage = LocalStorage(settings.UPLOAD_DIR, settings.UPLOAD_URL_PREFIX)
