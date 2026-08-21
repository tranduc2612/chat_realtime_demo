import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message, ReadReceipt, TypingEvent } from '../types';

vi.mock('../api/conversations', () => ({
  getConversations: vi.fn(),
}));
vi.mock('../api/messages', () => ({
  sendMessage: vi.fn(),
  getMessages: vi.fn(),
  getReadReceipts: vi.fn(),
  markRead: vi.fn(),
}));

import { getConversations } from '../api/conversations';
import {
  sendMessage as apiSendMessage,
  getMessages,
  getReadReceipts,
  markRead as apiMarkRead,
} from '../api/messages';
import { TYPING_TTL_MS, useChatStore } from './chatStore';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}

const initialState = useChatStore.getInitialState();

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversation_id: 'conv-1',
    sender_id: 'user-a',
    type: 'text',
    content: 'hello',
    reply_to_message_id: null,
    is_deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    attachments: [],
    ...overrides,
  };
}

function makeTypingEvent(overrides: Partial<TypingEvent> = {}): TypingEvent {
  return {
    conversation_id: 'conv-1',
    user_id: 'user-a',
    username: 'alice',
    full_name: 'Alice',
    avatar_url: null,
    is_typing: true,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    type: 'direct',
    name: null,
    avatar_url: null,
    created_by_id: 'user-a',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    members: [],
    ...overrides,
  };
}

beforeEach(() => {
  useChatStore.setState(initialState, true);
  vi.clearAllMocks();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('receiveMessage', () => {
  it('dedupes messages by id', () => {
    const msg = makeMessage();
    useChatStore.getState().receiveMessage(msg, false);
    useChatStore.getState().receiveMessage(msg, false);

    expect(useChatStore.getState().messages['conv-1']).toHaveLength(1);
  });

  it('increments unread only when fromOther is true, and not for own messages', () => {
    useChatStore.setState({ activeConversationId: 'conv-2' });

    useChatStore.getState().receiveMessage(makeMessage({ id: 'm1' }), true);
    expect(useChatStore.getState().unread['conv-1']).toBe(1);

    useChatStore.getState().receiveMessage(makeMessage({ id: 'm2' }), false);
    expect(useChatStore.getState().unread['conv-1']).toBe(1); // unchanged, own message
  });

  it('does not increment unread for the currently active conversation', () => {
    useChatStore.setState({ activeConversationId: 'conv-1' });
    useChatStore.getState().receiveMessage(makeMessage(), true);
    expect(useChatStore.getState().unread['conv-1'] ?? 0).toBe(0);
  });

  it('bumps and re-sorts the conversation by updated_at', () => {
    useChatStore.setState({
      conversations: [
        makeConversation({ id: 'conv-1', updated_at: '2026-01-01T00:00:00Z' }),
        makeConversation({ id: 'conv-2', updated_at: '2026-01-02T00:00:00Z' }),
      ],
    });

    useChatStore
      .getState()
      .receiveMessage(makeMessage({ conversation_id: 'conv-1', created_at: '2026-01-03T00:00:00Z' }), false);

    const ids = useChatStore.getState().conversations.map((c) => c.id);
    expect(ids).toEqual(['conv-1', 'conv-2']);
  });
});

describe('setActiveConversation', () => {
  it('resets unread to 0 and fetches history when not already loaded', () => {
    useChatStore.setState({ unread: { 'conv-1': 5 } });
    vi.mocked(getMessages).mockResolvedValue([]);

    useChatStore.getState().setActiveConversation('conv-1');

    expect(useChatStore.getState().activeConversationId).toBe('conv-1');
    expect(useChatStore.getState().unread['conv-1']).toBe(0);
    expect(getMessages).toHaveBeenCalledWith('conv-1', { limit: 50 });
  });

  it('does not refetch history when already loaded', () => {
    useChatStore.setState({ historyLoaded: { 'conv-1': true } });

    useChatStore.getState().setActiveConversation('conv-1');

    expect(getMessages).not.toHaveBeenCalled();
  });
});

describe('fetchHistory', () => {
  it('merges WS-arrived messages with fetched history, deduped and chronologically sorted', async () => {
    useChatStore.setState({
      messages: { 'conv-1': [makeMessage({ id: 'ws-1', created_at: '2026-01-03T00:00:00Z' })] },
    });
    vi.mocked(getMessages).mockResolvedValue([
      makeMessage({ id: 'h-1', created_at: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'h-2', created_at: '2026-01-02T00:00:00Z' }),
    ]);

    await useChatStore.getState().fetchHistory('conv-1');

    const ids = useChatStore.getState().messages['conv-1'].map((m) => m.id);
    expect(ids).toEqual(['h-1', 'h-2', 'ws-1']);
    expect(useChatStore.getState().historyLoaded['conv-1']).toBe(true);
    expect(useChatStore.getState().loadingHistory['conv-1']).toBe(false);
  });

  it('clears loadingHistory silently on API error, without setting historyLoaded', async () => {
    vi.mocked(getMessages).mockRejectedValue(new Error('network error'));

    await useChatStore.getState().fetchHistory('conv-1');

    expect(useChatStore.getState().loadingHistory['conv-1']).toBe(false);
    expect(useChatStore.getState().historyLoaded['conv-1']).toBeUndefined();
  });
});

describe('sendMessage', () => {
  it('calls the API then adds the message without incrementing unread', async () => {
    const msg = makeMessage();
    vi.mocked(apiSendMessage).mockResolvedValue(msg);

    await useChatStore.getState().sendMessage({ conversation_id: 'conv-1', type: 'text', content: 'hi' });

    expect(apiSendMessage).toHaveBeenCalledWith({ conversation_id: 'conv-1', type: 'text', content: 'hi' });
    expect(useChatStore.getState().messages['conv-1']).toHaveLength(1);
    expect(useChatStore.getState().unread['conv-1'] ?? 0).toBe(0);
  });
});

describe('connectWs', () => {
  it('closes an existing socket before opening a new one', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const first = FakeWebSocket.instances[0];

    useChatStore.getState().connectWs('conv-2', 'token-a');

    expect(first.closed).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('handles an incoming new_message event', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];
    const msg = makeMessage();

    socket.onmessage?.({ data: JSON.stringify({ event: 'new_message', data: msg }) });

    expect(useChatStore.getState().messages['conv-1']).toHaveLength(1);
  });

  it('ignores malformed JSON without throwing', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];

    expect(() => socket.onmessage?.({ data: 'not json' })).not.toThrow();
  });

  it('ignores unknown events', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];

    socket.onmessage?.({ data: JSON.stringify({ event: 'something_else', data: {} }) });

    expect(useChatStore.getState().messages['conv-1'] ?? []).toHaveLength(0);
  });

  it('routes an incoming typing event into typing state', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];

    socket.onmessage?.({ data: JSON.stringify({ event: 'typing', data: makeTypingEvent() }) });

    expect(useChatStore.getState().typing['conv-1']).toEqual([
      { user_id: 'user-a', username: 'alice', full_name: 'Alice', avatar_url: null },
    ]);
  });

  it('clears ws state on close', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];

    socket.close();

    expect(useChatStore.getState().ws).toBeNull();
  });
});

describe('receiveTyping', () => {
  it('adds and removes a user for the right conversation', () => {
    useChatStore.getState().receiveTyping(makeTypingEvent());
    expect(useChatStore.getState().typing['conv-1']).toHaveLength(1);

    useChatStore.getState().receiveTyping(makeTypingEvent({ is_typing: false }));
    expect(useChatStore.getState().typing['conv-1']).toHaveLength(0);
  });

  it('tracks multiple users without duplicating a repeated heartbeat', () => {
    useChatStore.getState().receiveTyping(makeTypingEvent({ user_id: 'user-a' }));
    useChatStore.getState().receiveTyping(makeTypingEvent({ user_id: 'user-b', username: 'bob' }));
    useChatStore.getState().receiveTyping(makeTypingEvent({ user_id: 'user-a' })); // heartbeat

    const ids = useChatStore.getState().typing['conv-1'].map((u) => u.user_id);
    expect(ids).toEqual(['user-a', 'user-b']);
  });

  it('keeps the same state object for a repeated heartbeat', () => {
    useChatStore.getState().receiveTyping(makeTypingEvent());
    const before = useChatStore.getState().typing;

    useChatStore.getState().receiveTyping(makeTypingEvent());

    expect(useChatStore.getState().typing).toBe(before);
  });

  it('expires a stale typing flag after the TTL when no stop event arrives', () => {
    vi.useFakeTimers();
    try {
      useChatStore.getState().receiveTyping(makeTypingEvent());
      expect(useChatStore.getState().typing['conv-1']).toHaveLength(1);

      vi.advanceTimersByTime(TYPING_TTL_MS + 1);

      expect(useChatStore.getState().typing['conv-1']).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the typing flag when that user’s message arrives', () => {
    useChatStore.getState().receiveTyping(makeTypingEvent({ user_id: 'user-a' }));
    useChatStore.getState().receiveTyping(makeTypingEvent({ user_id: 'user-b', username: 'bob' }));

    useChatStore.getState().receiveMessage(makeMessage({ sender_id: 'user-a' }), true);

    const ids = useChatStore.getState().typing['conv-1'].map((u) => u.user_id);
    expect(ids).toEqual(['user-b']);
  });
});

describe('read receipts', () => {
  function makeReceipt(overrides: Partial<ReadReceipt> = {}): ReadReceipt {
    return {
      user_id: 'user-b',
      username: 'bob',
      full_name: 'Bob',
      avatar_url: null,
      last_read_message_id: 'm1',
      ...overrides,
    };
  }

  it('fetchReads stores every member watermark', async () => {
    const receipts = [makeReceipt(), makeReceipt({ user_id: 'user-c', username: 'carol' })];
    vi.mocked(getReadReceipts).mockResolvedValue(receipts);

    await useChatStore.getState().fetchReads('conv-1');

    expect(useChatStore.getState().reads['conv-1']).toEqual(receipts);
  });

  it('fetchReads swallows API errors, leaving the chat usable', async () => {
    vi.mocked(getReadReceipts).mockRejectedValue(new Error('boom'));

    await useChatStore.getState().fetchReads('conv-1');

    expect(useChatStore.getState().reads['conv-1']).toBeUndefined();
  });

  it('receiveRead replaces that user’s watermark rather than appending', () => {
    useChatStore.getState().receiveRead({ conversation_id: 'conv-1', ...makeReceipt() });
    useChatStore
      .getState()
      .receiveRead({ conversation_id: 'conv-1', ...makeReceipt({ last_read_message_id: 'm7' }) });

    expect(useChatStore.getState().reads['conv-1']).toEqual([makeReceipt({ last_read_message_id: 'm7' })]);
  });

  it('receiveRead keeps other members untouched', () => {
    useChatStore.getState().receiveRead({ conversation_id: 'conv-1', ...makeReceipt() });
    useChatStore
      .getState()
      .receiveRead({ conversation_id: 'conv-1', ...makeReceipt({ user_id: 'user-c', username: 'carol' }) });

    expect(useChatStore.getState().reads['conv-1'].map((r) => r.user_id)).toEqual(['user-b', 'user-c']);
  });

  it('markRead calls the API once per message and records the result', async () => {
    const mine = makeReceipt({ user_id: 'user-a', username: 'alice', last_read_message_id: 'm3' });
    vi.mocked(apiMarkRead).mockResolvedValue(mine);

    await useChatStore.getState().markRead('conv-1', 'm3');
    await useChatStore.getState().markRead('conv-1', 'm3');

    expect(apiMarkRead).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().reads['conv-1']).toEqual([mine]);
  });

  it('markRead calls the API again once the watermark moves on', async () => {
    vi.mocked(apiMarkRead).mockResolvedValue(makeReceipt({ user_id: 'user-a' }));

    await useChatStore.getState().markRead('conv-1', 'm3');
    await useChatStore.getState().markRead('conv-1', 'm4');

    expect(apiMarkRead).toHaveBeenCalledTimes(2);
  });

  it('markRead lets a failed attempt be retried', async () => {
    vi.mocked(apiMarkRead).mockRejectedValueOnce(new Error('offline'));

    await useChatStore.getState().markRead('conv-1', 'm3');
    expect(useChatStore.getState().markedRead['conv-1']).toBeUndefined();

    vi.mocked(apiMarkRead).mockResolvedValue(makeReceipt({ user_id: 'user-a' }));
    await useChatStore.getState().markRead('conv-1', 'm3');

    expect(apiMarkRead).toHaveBeenCalledTimes(2);
  });

  it('routes a message_read event from the conversation socket', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];

    socket.onmessage?.({
      data: JSON.stringify({ event: 'message_read', data: { conversation_id: 'conv-1', ...makeReceipt() } }),
    });

    expect(useChatStore.getState().reads['conv-1']).toHaveLength(1);
  });

  // The user-level channel deliberately carries no receipts: the backend
  // broadcasts them to the room only, and opening a conversation refetches
  it('ignores a message_read event on the user socket', () => {
    useChatStore.getState().connectUserWs('token-a');
    const socket = FakeWebSocket.instances[0];

    socket.onmessage?.({
      data: JSON.stringify({ event: 'message_read', data: { conversation_id: 'conv-2', ...makeReceipt() } }),
    });

    expect(useChatStore.getState().reads['conv-2']).toBeUndefined();
  });
});

describe('sendTyping', () => {
  it('sends a typing frame up the conversation socket', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    useChatStore.setState({ activeConversationId: 'conv-1' });

    useChatStore.getState().sendTyping(true);

    expect(FakeWebSocket.instances[0].sent).toEqual([
      JSON.stringify({ event: 'typing', data: { is_typing: true } }),
    ]);
  });

  it('is a no-op with no socket or no active conversation', () => {
    expect(() => useChatStore.getState().sendTyping(true)).not.toThrow();

    useChatStore.getState().connectWs('conv-1', 'token-a'); // activeConversationId still null
    useChatStore.getState().sendTyping(true);

    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });
});

describe('connectUserWs', () => {
  it('increments unread (fromOther=true) and fetches conversations for an unknown conversation', () => {
    vi.mocked(getConversations).mockResolvedValue([]);
    useChatStore.getState().connectUserWs('token-a');
    const socket = FakeWebSocket.instances[0];
    const msg = makeMessage({ conversation_id: 'conv-unknown' });

    socket.onmessage?.({ data: JSON.stringify({ event: 'new_message', data: msg }) });

    expect(useChatStore.getState().unread['conv-unknown']).toBe(1);
    expect(getConversations).toHaveBeenCalled();
  });

  it('does not refetch conversations when the conversation is already known', () => {
    useChatStore.setState({ conversations: [makeConversation({ id: 'conv-1' })] });
    useChatStore.getState().connectUserWs('token-a');
    const socket = FakeWebSocket.instances[0];

    socket.onmessage?.({ data: JSON.stringify({ event: 'new_message', data: makeMessage() }) });

    expect(getConversations).not.toHaveBeenCalled();
  });
});
