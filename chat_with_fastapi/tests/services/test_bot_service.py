from unittest.mock import AsyncMock

import pytest

from app.models.bot_conversation import BotConversation, BotMessage, BotMessageRole
from app.services.bot_service import BotService, derive_title
from tests.conftest import make_result


# ── title derivation ────────────────────────────────────────────────────────

def test_derive_title_uses_the_question():
    assert derive_title("How much vacation do I get?") == "How much vacation do I get?"


def test_derive_title_collapses_whitespace():
    assert derive_title("  How   much\nvacation?  ") == "How much vacation?"


def test_derive_title_truncates_long_questions():
    title = derive_title("word " * 50)
    assert len(title) <= 60
    assert title.endswith("…")


def test_derive_title_falls_back_for_blank_input():
    assert derive_title("   ") == "New chat"


# ── conversations ───────────────────────────────────────────────────────────

async def test_get_conversation_scopes_to_owner(mock_db):
    conversation = BotConversation(id="bc-1", user_id="user-a")
    mock_db.execute.return_value = make_result(scalar_one_or_none=conversation)

    assert await BotService(mock_db).get_conversation("bc-1", "user-a") is conversation


async def test_get_conversation_returns_none_for_other_users(mock_db):
    # The user_id predicate is part of the query, so someone else's thread
    # simply doesn't match.
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    assert await BotService(mock_db).get_conversation("bc-1", "user-b") is None


async def test_list_conversations(mock_db):
    conversations = [BotConversation(id="bc-1"), BotConversation(id="bc-2")]
    mock_db.execute.return_value = make_result(scalars_all=conversations)

    assert await BotService(mock_db).list_conversations("user-a") == conversations


async def test_create_conversation(mock_db):
    conversation = await BotService(mock_db).create_conversation("user-a", "Onboarding")

    assert conversation.user_id == "user-a"
    assert conversation.title == "Onboarding"
    mock_db.add.assert_called_once_with(conversation)
    mock_db.commit.assert_awaited_once()


async def test_delete_conversation_missing_returns_false(mock_db):
    mock_db.execute.return_value = make_result(scalar_one_or_none=None)

    assert await BotService(mock_db).delete_conversation("bc-1", "user-a") is False
    mock_db.delete.assert_not_called()


async def test_delete_conversation_success(mock_db):
    conversation = BotConversation(id="bc-1", user_id="user-a")
    mock_db.execute.return_value = make_result(scalar_one_or_none=conversation)
    mock_db.delete = AsyncMock()

    assert await BotService(mock_db).delete_conversation("bc-1", "user-a") is True
    mock_db.delete.assert_awaited_once_with(conversation)


# ── history ─────────────────────────────────────────────────────────────────

async def test_history_for_prompt_returns_oldest_first(mock_db):
    # The query orders DESC (so the limit keeps the *latest* turns); the
    # service reverses it back into chronological order for the prompt.
    newest_first = [
        BotMessage(role=BotMessageRole.ASSISTANT, content="25 days."),
        BotMessage(role=BotMessageRole.USER, content="How much vacation?"),
    ]
    mock_db.execute.return_value = make_result(scalars_all=newest_first)

    history = await BotService(mock_db).history_for_prompt("bc-1", 10)

    assert history == [
        {"role": "user", "content": "How much vacation?"},
        {"role": "assistant", "content": "25 days."},
    ]


async def test_history_for_prompt_skips_empty_messages(mock_db):
    mock_db.execute.return_value = make_result(
        scalars_all=[
            BotMessage(role=BotMessageRole.ASSISTANT, content=""),
            BotMessage(role=BotMessageRole.USER, content="Hi"),
        ]
    )

    history = await BotService(mock_db).history_for_prompt("bc-1", 10)

    assert history == [{"role": "user", "content": "Hi"}]


# ── messages ────────────────────────────────────────────────────────────────

async def test_add_message_titles_an_untitled_thread_from_the_first_question(mock_db):
    conversation = BotConversation(id="bc-1", user_id="user-a", title=None)
    mock_db.get = AsyncMock(return_value=conversation)

    await BotService(mock_db).add_message(
        "bc-1", BotMessageRole.USER, "What is the expense policy?"
    )

    assert conversation.title == "What is the expense policy?"


async def test_add_message_does_not_retitle_an_existing_thread(mock_db):
    conversation = BotConversation(id="bc-1", user_id="user-a", title="Original")
    mock_db.get = AsyncMock(return_value=conversation)

    await BotService(mock_db).add_message("bc-1", BotMessageRole.USER, "Another question")

    assert conversation.title == "Original"


async def test_add_message_never_titles_from_an_assistant_turn(mock_db):
    conversation = BotConversation(id="bc-1", user_id="user-a", title=None)
    mock_db.get = AsyncMock(return_value=conversation)

    await BotService(mock_db).add_message("bc-1", BotMessageRole.ASSISTANT, "Some answer")

    assert conversation.title is None


async def test_add_message_persists_rag_metadata(mock_db):
    conversation = BotConversation(id="bc-1", user_id="user-a", title="t")
    mock_db.get = AsyncMock(return_value=conversation)
    citations = [{"index": 1, "filename": "hr.pdf"}]

    message = await BotService(mock_db).add_message(
        "bc-1",
        BotMessageRole.ASSISTANT,
        "25 days [1].",
        citations=citations,
        model="gpt-4o-mini",
        prompt_tokens=800,
        completion_tokens=12,
    )

    assert message.citations == citations
    assert message.model == "gpt-4o-mini"
    assert (message.prompt_tokens, message.completion_tokens) == (800, 12)
    mock_db.commit.assert_awaited_once()


async def test_add_message_survives_a_missing_conversation(mock_db):
    # Thread deleted mid-stream: persisting the answer must not blow up the
    # streaming generator.
    mock_db.get = AsyncMock(return_value=None)

    message = await BotService(mock_db).add_message("bc-gone", BotMessageRole.ASSISTANT, "text")

    assert message.content == "text"
