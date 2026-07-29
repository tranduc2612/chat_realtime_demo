from datetime import datetime, timezone

import pytest

from app.models.conversation import Conversation, ConversationType
from app.models.conversation_member import ConversationMember, ConversationMemberRole
from app.schemas.conversation import ConversationCreate
from app.services.conversation_service import ConversationService
from tests.conftest import make_result


async def test_find_direct_found(mock_db):
    conv = Conversation(type=ConversationType.DIRECT)
    mock_db.execute.return_value = make_result(scalar_one_or_none=conv)

    service = ConversationService(mock_db)
    result = await service.find_direct("user-a", "user-b")

    assert result is conv


async def test_find_direct_not_found(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    service = ConversationService(mock_db)
    result = await service.find_direct("user-a", "user-b")

    assert result is None


async def test_get_list_for_user(mock_db):
    convs = [Conversation(type=ConversationType.GROUP), Conversation(type=ConversationType.DIRECT)]
    mock_db.execute.return_value = make_result(scalars_all=convs)

    service = ConversationService(mock_db)
    result = await service.get_list_for_user("user-a")

    assert result == convs


async def test_get_with_members_found(mock_db):
    conv = Conversation(id="conv-1", type=ConversationType.GROUP)
    mock_db.execute.return_value = make_result(scalar_one_or_none=conv)

    service = ConversationService(mock_db)
    result = await service.get_with_members("conv-1")

    assert result is conv


async def test_get_with_members_not_found(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    service = ConversationService(mock_db)
    result = await service.get_with_members("missing")

    assert result is None


async def test_create_direct_success(mock_db):
    data = ConversationCreate(type=ConversationType.DIRECT, user_ids=["user-b"], created_by_id="user-a")

    service = ConversationService(mock_db)
    conversation = await service.create(data)

    assert conversation.type == ConversationType.DIRECT
    assert conversation.created_by_id == "user-a"
    mock_db.flush.assert_awaited_once()
    mock_db.commit.assert_awaited_once()
    mock_db.refresh.assert_awaited_once_with(conversation)

    added = [call.args[0] for call in mock_db.add.call_args_list]
    members = [m for m in added if isinstance(m, ConversationMember)]
    assert len(members) == 2
    owner = next(m for m in members if m.role == ConversationMemberRole.OWNER)
    other = next(m for m in members if m.role == ConversationMemberRole.MEMBER)
    assert owner.user_id == "user-a"
    assert other.user_id == "user-b"


async def test_create_group_success(mock_db):
    data = ConversationCreate(
        type=ConversationType.GROUP,
        name="Team chat",
        user_ids=["user-b", "user-c"],
        created_by_id="user-a",
    )

    service = ConversationService(mock_db)
    conversation = await service.create(data)

    assert conversation.type == ConversationType.GROUP
    assert conversation.name == "Team chat"

    added = [call.args[0] for call in mock_db.add.call_args_list]
    members = [m for m in added if isinstance(m, ConversationMember)]
    assert len(members) == 3  # owner + 2 group members
    roles = {m.user_id: m.role for m in members}
    assert roles["user-a"] == ConversationMemberRole.OWNER
    assert roles["user-b"] == ConversationMemberRole.MEMBER
    assert roles["user-c"] == ConversationMemberRole.MEMBER


@pytest.mark.parametrize(
    "conv_type,user_ids",
    [
        (ConversationType.DIRECT, []),
        (ConversationType.DIRECT, ["user-b", "user-c"]),
        (ConversationType.GROUP, []),
        (ConversationType.GROUP, ["user-b"]),
    ],
)
async def test_create_invalid_type_or_user_ids_raises(mock_db, conv_type, user_ids):
    data = ConversationCreate(type=conv_type, user_ids=user_ids, created_by_id="user-a")
    service = ConversationService(mock_db)

    with pytest.raises(ValueError, match="Invalid conversation type or user IDs"):
        await service.create(data)

    mock_db.commit.assert_not_awaited()


async def test_add_members_requester_not_member_raises(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)
    service = ConversationService(mock_db)

    with pytest.raises(ValueError, match="Not a member of this conversation"):
        await service.add_members("conv-1", ["user-b"], requester_id="user-a")


async def test_add_members_conversation_not_group_raises(mock_db):
    requester_membership = ConversationMember(conversation_id="conv-1", user_id="user-a", left_at=None)
    direct_conv = Conversation(id="conv-1", type=ConversationType.DIRECT)
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=requester_membership),
        make_result(scalar_one_or_none=direct_conv),
    ]
    service = ConversationService(mock_db)

    with pytest.raises(ValueError, match="Only group conversations support adding members"):
        await service.add_members("conv-1", ["user-b"], requester_id="user-a")


async def test_add_members_conversation_missing_raises(mock_db):
    requester_membership = ConversationMember(conversation_id="conv-1", user_id="user-a", left_at=None)
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=requester_membership),
        make_result(scalar_one_or_none=None),
    ]
    service = ConversationService(mock_db)

    with pytest.raises(ValueError, match="Only group conversations support adding members"):
        await service.add_members("conv-1", ["user-b"], requester_id="user-a")


async def test_add_members_new_user_added(mock_db):
    requester_membership = ConversationMember(conversation_id="conv-1", user_id="user-a", left_at=None)
    group_conv = Conversation(id="conv-1", type=ConversationType.GROUP)
    final_conv = Conversation(id="conv-1", type=ConversationType.GROUP)
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=requester_membership),  # requester membership check
        make_result(scalar_one_or_none=group_conv),  # conversation lookup
        make_result(scalar_one_or_none=None),  # existing member lookup for user-b
        make_result(scalar_one_or_none=final_conv),  # get_with_members reload
    ]
    service = ConversationService(mock_db)

    result = await service.add_members("conv-1", ["user-b"], requester_id="user-a")

    assert result is final_conv
    mock_db.commit.assert_awaited_once()
    added = [call.args[0] for call in mock_db.add.call_args_list]
    assert len(added) == 1
    assert added[0].user_id == "user-b"
    assert added[0].role == ConversationMemberRole.MEMBER


async def test_add_members_reactivates_left_member(mock_db):
    requester_membership = ConversationMember(conversation_id="conv-1", user_id="user-a", left_at=None)
    group_conv = Conversation(id="conv-1", type=ConversationType.GROUP)
    left_member = ConversationMember(
        conversation_id="conv-1",
        user_id="user-b",
        role=ConversationMemberRole.ADMIN,
        left_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    final_conv = Conversation(id="conv-1", type=ConversationType.GROUP)
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=requester_membership),
        make_result(scalar_one_or_none=group_conv),
        make_result(scalar_one_or_none=left_member),
        make_result(scalar_one_or_none=final_conv),
    ]
    service = ConversationService(mock_db)

    await service.add_members("conv-1", ["user-b"], requester_id="user-a")

    assert left_member.left_at is None
    assert left_member.role == ConversationMemberRole.MEMBER
    mock_db.add.assert_not_called()


async def test_add_members_skips_already_active_member(mock_db):
    requester_membership = ConversationMember(conversation_id="conv-1", user_id="user-a", left_at=None)
    group_conv = Conversation(id="conv-1", type=ConversationType.GROUP)
    active_member = ConversationMember(
        conversation_id="conv-1",
        user_id="user-b",
        role=ConversationMemberRole.MEMBER,
        left_at=None,
    )
    final_conv = Conversation(id="conv-1", type=ConversationType.GROUP)
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=requester_membership),
        make_result(scalar_one_or_none=group_conv),
        make_result(scalar_one_or_none=active_member),
        make_result(scalar_one_or_none=final_conv),
    ]
    service = ConversationService(mock_db)

    await service.add_members("conv-1", ["user-b"], requester_id="user-a")

    mock_db.add.assert_not_called()
    assert active_member.role == ConversationMemberRole.MEMBER
