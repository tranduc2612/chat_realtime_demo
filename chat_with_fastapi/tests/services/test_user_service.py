from unittest.mock import AsyncMock, patch

import pytest

from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate
from app.services.user_service import ProfileUpdateError, UserService
from tests.conftest import make_result


async def test_get_by_id_found(mock_db):
    user = User(id="u1")
    mock_db.execute.return_value = make_result(scalar_one_or_none=user)

    service = UserService(mock_db)
    result = await service.get_by_id("u1")

    assert result is user


async def test_get_by_id_not_found(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    service = UserService(mock_db)
    result = await service.get_by_id("missing")

    assert result is None


async def test_get_by_email(mock_db):
    user = User(email="a@example.com")
    mock_db.execute.return_value = make_result(scalar_one_or_none=user)

    service = UserService(mock_db)
    result = await service.get_by_email("a@example.com")

    assert result is user


async def test_get_by_username(mock_db):
    user = User(username="alice")
    mock_db.execute.return_value = make_result(scalar_one_or_none=user)

    service = UserService(mock_db)
    result = await service.get_by_username("alice")

    assert result is user


async def test_disable_account(mock_db):
    user = User(id="u1", is_active=True)
    service = UserService(mock_db)

    result = await service.disable_account(user)

    assert result is None
    assert not user.is_active
    mock_db.add.assert_called_once_with(user)
    mock_db.commit.assert_awaited_once()


async def test_create_hashes_password_and_persists(mock_db):
    data = UserCreate(email="a@example.com", username="alice", password="supersecret1")

    with patch("app.services.user_service.hash_password", return_value="hashed-value") as mock_hash:
        service = UserService(mock_db)
        result = await service.create(data)

    mock_hash.assert_called_once_with("supersecret1")
    assert result.hashed_password == "hashed-value"
    assert result.email == "a@example.com"
    assert result.username == "alice"
    mock_db.add.assert_called_once_with(result)
    mock_db.flush.assert_awaited_once()
    mock_db.refresh.assert_awaited_once_with(result)


async def test_search(mock_db):
    users = [User(username="bob"), User(username="bobby")]
    mock_db.execute.return_value = make_result(scalars_all=users)

    service = UserService(mock_db)
    result = await service.search("bob", exclude_id="u1")

    assert result == users
    mock_db.execute.assert_awaited_once()


async def test_authenticate_unknown_username(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    service = UserService(mock_db)
    result = await service.authenticate("ghost", "password")

    assert result is None


async def test_authenticate_wrong_password(mock_db):
    user = User(username="alice", hashed_password="hashed")
    mock_db.execute.return_value = make_result(scalar_one_or_none=user)

    with patch("app.services.user_service.verify_password", return_value=False) as mock_verify:
        service = UserService(mock_db)
        result = await service.authenticate("alice", "wrong")

    mock_verify.assert_called_once_with("wrong", "hashed")
    assert result is None


async def test_authenticate_success(mock_db):
    user = User(username="alice", hashed_password="hashed")
    mock_db.execute.return_value = make_result(scalar_one_or_none=user)

    with patch("app.services.user_service.verify_password", return_value=True):
        service = UserService(mock_db)
        result = await service.authenticate("alice", "correct")

    assert result is user


# ── Profile updates ─────────────────────────────────────────────────────────

async def test_update_changes_only_the_fields_that_were_sent(mock_db):
    user = User(id="u1", username="alice", email="a@example.com", full_name="Alice")
    data = UserUpdate(full_name="Alice Cooper")

    service = UserService(mock_db)
    result = await service.update(user, data)

    assert result.full_name == "Alice Cooper"
    # Untouched, because it wasn't in the payload at all
    assert result.email == "a@example.com"
    mock_db.flush.assert_awaited_once()


async def test_update_can_clear_full_name(mock_db):
    user = User(id="u1", username="alice", full_name="Alice")

    service = UserService(mock_db)
    await service.update(user, UserUpdate(full_name="   "))

    assert user.full_name is None


async def test_update_ignores_a_username_in_the_payload(mock_db):
    """Username is the login identifier — not editable, however it's sent."""
    user = User(id="u1", username="alice", full_name="Alice")

    service = UserService(mock_db)
    await service.update(user, UserUpdate.model_validate({"username": "bob", "full_name": "Alice C"}))

    assert user.username == "alice"
    assert user.full_name == "Alice C"


async def test_update_allows_resubmitting_your_own_email(mock_db):
    """The lookup finds *you*, which is not a conflict."""
    user = User(id="u1", email="a@example.com")
    mock_db.execute.return_value = make_result(scalar_one_or_none=user)

    service = UserService(mock_db)
    await service.update(user, UserUpdate(email="a@example.com"))

    assert user.email == "a@example.com"


async def test_update_rejects_an_email_someone_else_holds(mock_db):
    user = User(id="u1", email="a@example.com")
    mock_db.execute.return_value = make_result(scalar_one_or_none=User(id="u2", email="b@example.com"))

    service = UserService(mock_db)
    with pytest.raises(ProfileUpdateError) as exc:
        await service.update(user, UserUpdate(email="b@example.com"))

    assert exc.value.key == "email_already_registered"
    assert user.email == "a@example.com"


async def test_update_password_requires_the_current_one(mock_db):
    user = User(id="u1", hashed_password="hashed")

    with patch("app.services.user_service.verify_password", return_value=False):
        service = UserService(mock_db)
        with pytest.raises(ProfileUpdateError) as exc:
            await service.update(user, UserUpdate(password="newpassword1", current_password="wrong"))

    assert exc.value.key == "current_password_incorrect"
    assert user.hashed_password == "hashed"


async def test_update_password_rejects_a_missing_current_password(mock_db):
    user = User(id="u1", hashed_password="hashed")

    service = UserService(mock_db)
    with pytest.raises(ProfileUpdateError) as exc:
        await service.update(user, UserUpdate(password="newpassword1"))

    assert exc.value.key == "current_password_incorrect"


async def test_update_password_rehashes_when_current_password_matches(mock_db):
    user = User(id="u1", hashed_password="hashed")

    with patch("app.services.user_service.verify_password", return_value=True), \
         patch("app.services.user_service.hash_password", return_value="new-hash") as mock_hash:
        service = UserService(mock_db)
        await service.update(user, UserUpdate(password="newpassword1", current_password="oldpassword1"))

    mock_hash.assert_called_once_with("newpassword1")
    assert user.hashed_password == "new-hash"


# ── Avatars ─────────────────────────────────────────────────────────────────

async def test_set_avatar_stores_the_file_and_removes_the_previous_one(mock_db):
    user = User(id="u1", avatar_url="/uploads/avatars/old.png")

    with patch("app.services.user_service.storage") as mock_storage:
        mock_storage.save = AsyncMock(return_value="/uploads/avatars/new.png")
        mock_storage.delete = AsyncMock()

        service = UserService(mock_db)
        await service.set_avatar(user, b"bytes", "png")

    mock_storage.save.assert_awaited_once_with(b"bytes", folder="avatars", ext="png")
    assert user.avatar_url == "/uploads/avatars/new.png"
    mock_db.commit.assert_awaited_once()
    mock_storage.delete.assert_awaited_once_with("/uploads/avatars/old.png")


async def test_set_avatar_removes_the_new_file_if_the_write_fails(mock_db):
    """Otherwise a failed commit leaves an unreferenced file on disk forever."""
    user = User(id="u1", avatar_url="/uploads/avatars/old.png")
    mock_db.commit.side_effect = RuntimeError("db is down")

    with patch("app.services.user_service.storage") as mock_storage:
        mock_storage.save = AsyncMock(return_value="/uploads/avatars/new.png")
        mock_storage.delete = AsyncMock()

        service = UserService(mock_db)
        with pytest.raises(RuntimeError):
            await service.set_avatar(user, b"bytes", "png")

    # The new file is cleaned up; the old one — still referenced by the row
    # the rollback restores — is left alone.
    mock_storage.delete.assert_awaited_once_with("/uploads/avatars/new.png")


async def test_clear_avatar_unsets_the_column_and_deletes_the_file(mock_db):
    user = User(id="u1", avatar_url="/uploads/avatars/old.png")

    with patch("app.services.user_service.storage") as mock_storage:
        mock_storage.delete = AsyncMock()

        service = UserService(mock_db)
        await service.clear_avatar(user)

    assert user.avatar_url is None
    mock_db.commit.assert_awaited_once()
    mock_storage.delete.assert_awaited_once_with("/uploads/avatars/old.png")
