from unittest.mock import patch

from app.models.user import User
from app.schemas.user import UserCreate
from app.services.user_service import UserService
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
