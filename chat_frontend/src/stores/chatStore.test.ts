import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, Message } from '../types';

vi.mock('../api/conversations', () => ({
  getConversations: vi.fn(),
}));
vi.mock('../api/messages', () => ({
  sendMessage: vi.fn(),
  getMessages: vi.fn(),
}));

import { getConversations } from '../api/conversations';
import { sendMessage as apiSendMessage, getMessages } from '../api/messages';
import { useChatStore } from './chatStore';

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

  send() {}
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

  it('ignores events other than new_message', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];

    socket.onmessage?.({ data: JSON.stringify({ event: 'typing', data: {} }) });

    expect(useChatStore.getState().messages['conv-1'] ?? []).toHaveLength(0);
  });

  it('clears ws state on close', () => {
    useChatStore.getState().connectWs('conv-1', 'token-a');
    const socket = FakeWebSocket.instances[0];

    socket.close();

    expect(useChatStore.getState().ws).toBeNull();
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
