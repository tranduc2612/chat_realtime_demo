from datetime import datetime, timezone

import pytest

from app.models.conversation import Conversation
from app.models.conversation_member import ConversationMember
from app.models.message import Message, MessageType
from app.models.message_attachment import AttachmentType, MessageAttachment
from app.models.user import User
from app.schemas.message import AttachmentCreate, SendMessage
from app.services.message_service import MessageService
from tests.conftest import make_result


async def test_get_member_found(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    mock_db.execute.return_value = make_result(scalar_one_or_none=member)

    service = MessageService(mock_db)
    result = await service.get_member("conv-1", "user-a")

    assert result is member


async def test_get_member_not_found(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    service = MessageService(mock_db)
    result = await service.get_member("conv-1", "user-a")

    assert result is None


async def test_get_member_ids(mock_db):
    mock_db.execute.return_value = make_result(scalars_all=["user-a", "user-b"])

    service = MessageService(mock_db)
    result = await service.get_member_ids("conv-1")

    assert result == ["user-a", "user-b"]


async def test_get_history_success(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    messages = [Message(id="m1"), Message(id="m2")]
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),  # get_member
        make_result(scalars_all=messages),  # main history query (DESC order)
    ]

    service = MessageService(mock_db)
    result = await service.get_history("conv-1", "user-a")

    assert result == list(reversed(messages))


async def test_get_history_not_member_raises(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)
    service = MessageService(mock_db)

    with pytest.raises(PermissionError, match="User is not a member of this conversation"):
        await service.get_history("conv-1", "user-a")


async def test_get_history_with_valid_before_id(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    cursor_ts = datetime(2026, 1, 1, tzinfo=timezone.utc)
    messages = [Message(id="m1")]
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),  # get_member
        make_result(scalar_one_or_none=cursor_ts),  # before_id cursor lookup
        make_result(scalars_all=messages),  # main query, filtered
    ]

    service = MessageService(mock_db)
    result = await service.get_history("conv-1", "user-a", before_id="m0")

    assert result == list(reversed(messages))
    assert mock_db.execute.call_count == 3


async def test_get_history_with_unknown_before_id_is_ignored(mock_db):
    """An invalid/unknown before_id silently skips the cursor filter instead of erroring."""
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    messages = [Message(id="m1")]
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),  # get_member
        make_result(scalar_one_or_none=None),  # cursor lookup: before_id not found
        make_result(scalars_all=messages),  # main query still runs, unfiltered
    ]

    service = MessageService(mock_db)
    result = await service.get_history("conv-1", "user-a", before_id="does-not-exist")

    assert result == list(reversed(messages))


async def test_send_no_attachments(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    conv = Conversation(id="conv-1")
    saved_message = Message(id="m1", conversation_id="conv-1", sender_id="user-a", content="hi")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),  # get_member
        make_result(scalar_one_or_none=conv),  # conversation lookup (bump updated_at)
        make_result(scalar_one=saved_message),  # reload with attachments
    ]
    data = SendMessage(conversation_id="conv-1", type=MessageType.TEXT, content="hi")

    service = MessageService(mock_db)
    result = await service.send("user-a", data)

    assert result is saved_message
    mock_db.commit.assert_awaited_once()
    assert conv.updated_at is not None

    added = [call.args[0] for call in mock_db.add.call_args_list]
    assert sum(isinstance(a, Message) for a in added) == 1
    assert not any(isinstance(a, MessageAttachment) for a in added)


async def test_send_with_attachments(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    conv = Conversation(id="conv-1")
    saved_message = Message(id="m1")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(scalar_one_or_none=conv),
        make_result(scalar_one=saved_message),
    ]
    data = SendMessage(
        conversation_id="conv-1",
        content="pic",
        attachments=[
            AttachmentCreate(type=AttachmentType.IMAGE, url="http://x/1.png"),
            AttachmentCreate(type=AttachmentType.IMAGE, url="http://x/2.png"),
        ],
    )

    service = MessageService(mock_db)
    await service.send("user-a", data)

    added = [call.args[0] for call in mock_db.add.call_args_list]
    attachments_added = [a for a in added if isinstance(a, MessageAttachment)]
    assert len(attachments_added) == 2
    assert {a.url for a in attachments_added} == {"http://x/1.png", "http://x/2.png"}


async def test_send_not_member_raises(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)
    data = SendMessage(conversation_id="conv-1", content="hi")
    service = MessageService(mock_db)

    with pytest.raises(PermissionError, match="User is not a member of this conversation"):
        await service.send("user-a", data)

    mock_db.add.assert_not_called()
    mock_db.commit.assert_not_awaited()


async def test_send_marks_the_sender_as_having_read_their_own_message(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    conv = Conversation(id="conv-1")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(scalar_one_or_none=conv),
        make_result(scalar_one=Message(id="m1")),
    ]
    data = SendMessage(conversation_id="conv-1", content="hi")

    service = MessageService(mock_db)
    await service.send("user-a", data)

    sent = next(a for a in (c.args[0] for c in mock_db.add.call_args_list) if isinstance(a, Message))
    assert member.last_read_message_id == sent.id


async def test_get_read_receipts_returns_each_member_watermark(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    alice, bob = User(id="user-a"), User(id="user-b")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(all_rows=[(alice, "m5"), (bob, None)]),
    ]

    service = MessageService(mock_db)
    result = await service.get_read_receipts("conv-1", "user-a")

    assert result == [(alice, "m5"), (bob, None)]


async def test_get_read_receipts_not_member_raises(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)
    service = MessageService(mock_db)

    with pytest.raises(PermissionError, match="User is not a member of this conversation"):
        await service.get_read_receipts("conv-1", "user-a")


async def test_mark_read_advances_the_watermark(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a", last_read_message_id="m1")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(scalar_one_or_none=datetime(2026, 1, 2, tzinfo=timezone.utc)),  # target m2
        make_result(scalar_one_or_none=datetime(2026, 1, 1, tzinfo=timezone.utc)),  # current m1
    ]

    service = MessageService(mock_db)
    result = await service.mark_read("conv-1", "user-a", "m2")

    assert result is member
    assert member.last_read_message_id == "m2"
    mock_db.commit.assert_awaited_once()


async def test_mark_read_from_no_previous_watermark(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(scalar_one_or_none=datetime(2026, 1, 2, tzinfo=timezone.utc)),
    ]

    service = MessageService(mock_db)
    result = await service.mark_read("conv-1", "user-a", "m2")

    assert result is member
    assert member.last_read_message_id == "m2"


async def test_mark_read_is_a_noop_when_already_at_that_message(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a", last_read_message_id="m2")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(scalar_one_or_none=datetime(2026, 1, 2, tzinfo=timezone.utc)),
    ]

    service = MessageService(mock_db)
    result = await service.mark_read("conv-1", "user-a", "m2")

    assert result is None
    mock_db.commit.assert_not_awaited()


async def test_mark_read_never_moves_the_watermark_backwards(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a", last_read_message_id="m9")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(scalar_one_or_none=datetime(2026, 1, 1, tzinfo=timezone.utc)),  # older target
        make_result(scalar_one_or_none=datetime(2026, 1, 5, tzinfo=timezone.utc)),  # current, newer
    ]

    service = MessageService(mock_db)
    result = await service.mark_read("conv-1", "user-a", "m3")

    assert result is None
    assert member.last_read_message_id == "m9"
    mock_db.commit.assert_not_awaited()


async def test_mark_read_rejects_a_message_from_another_conversation(mock_db):
    member = ConversationMember(conversation_id="conv-1", user_id="user-a")
    mock_db.execute.side_effect = [
        make_result(scalar_one_or_none=member),
        make_result(scalar_one_or_none=None),  # message not found in this conversation
    ]

    service = MessageService(mock_db)
    with pytest.raises(ValueError, match="Message does not belong to this conversation"):
        await service.mark_read("conv-1", "user-a", "m-other")

    mock_db.commit.assert_not_awaited()


async def test_mark_read_not_member_raises(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)
    service = MessageService(mock_db)

    with pytest.raises(PermissionError, match="User is not a member of this conversation"):
        await service.mark_read("conv-1", "user-a", "m1")
