import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskHandlers } from '../api/bot';

vi.mock('../api/bot', () => ({
  askBot: vi.fn(),
  createBotConversation: vi.fn(),
  deleteBotConversation: vi.fn(),
  getBotConversations: vi.fn(),
  getBotMessages: vi.fn(),
}));
vi.mock('../api/documents', () => ({ getKnowledgeBaseStats: vi.fn() }));

import {
  askBot,
  createBotConversation,
  deleteBotConversation,
  getBotConversations,
  getBotMessages,
} from '../api/bot';
import { useBotStore } from './botStore';

const initialState = useBotStore.getInitialState();

function makeConversation(id = 'bc-1') {
  return {
    id,
    user_id: 'user-a',
    title: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/** Drive askBot's handler callbacks to simulate a full stream. */
function respondWith(script: (handlers: AskHandlers) => void) {
  vi.mocked(askBot).mockImplementation(async (_id, _q, handlers) => {
    script(handlers);
  });
}

beforeEach(() => {
  useBotStore.setState(initialState, true);
  vi.clearAllMocks();
  vi.mocked(getBotConversations).mockResolvedValue([]);
});

describe('botStore', () => {
  it('opens a conversation implicitly when asking with none selected', async () => {
    vi.mocked(createBotConversation).mockResolvedValue(makeConversation());
    respondWith((h) => {
      h.onDelta?.('Hi');
      h.onDone?.({ message_id: 'm-1', created_at: null, failed: false, prompt_tokens: 1, completion_tokens: 2 });
    });

    await useBotStore.getState().ask('How much vacation?');

    expect(createBotConversation).toHaveBeenCalledTimes(1);
    expect(useBotStore.getState().activeConversationId).toBe('bc-1');
  });

  it('shows the question optimistically and accumulates streamed deltas', async () => {
    useBotStore.setState({ activeConversationId: 'bc-1', messages: { 'bc-1': [] } });
    respondWith((h) => {
      h.onCitations?.([{ index: 1, document_id: 'd1', filename: 'hr.pdf', chunk_index: 0, snippet: 's', distance: 0.2 }]);
      h.onDelta?.('Vacation ');
      h.onDelta?.('is 25 days.');
      h.onDone?.({ message_id: 'm-1', created_at: '2026-01-02T00:00:00Z', failed: false, prompt_tokens: 800, completion_tokens: 12 });
    });

    await useBotStore.getState().ask('How much vacation?');

    const thread = useBotStore.getState().messages['bc-1'];
    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({ role: 'user', content: 'How much vacation?' });
    expect(thread[1]).toMatchObject({
      role: 'assistant',
      content: 'Vacation is 25 days.',
      // The placeholder id is replaced by the persisted one, so a later
      // refetch doesn't duplicate the message.
      id: 'm-1',
      streaming: false,
      prompt_tokens: 800,
    });
    expect(thread[1].citations).toHaveLength(1);
  });

  it('clears the streaming flag and records the detail when the stream errors', async () => {
    useBotStore.setState({ activeConversationId: 'bc-1', messages: { 'bc-1': [] } });
    respondWith((h) => {
      h.onDelta?.('partial');
      h.onError?.('The assistant stopped unexpectedly.');
    });

    await useBotStore.getState().ask('q');

    const state = useBotStore.getState();
    expect(state.error).toBe('The assistant stopped unexpectedly.');
    expect(state.streaming).toBe(false);
    // Whatever streamed in is kept rather than discarded.
    expect(state.messages['bc-1'][1]).toMatchObject({ content: 'partial', streaming: false });
  });

  it('does not report an error when the user stops generation', async () => {
    useBotStore.setState({ activeConversationId: 'bc-1', messages: { 'bc-1': [] } });
    vi.mocked(askBot).mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await useBotStore.getState().ask('q');

    expect(useBotStore.getState().error).toBeNull();
    expect(useBotStore.getState().streaming).toBe(false);
  });

  it('reports an error when the assistant is unreachable', async () => {
    useBotStore.setState({ activeConversationId: 'bc-1', messages: { 'bc-1': [] } });
    vi.mocked(askBot).mockRejectedValue(new Error('network down'));

    await useBotStore.getState().ask('q');

    expect(useBotStore.getState().error).toBe('The assistant is unreachable. Please try again.');
  });

  it('loads messages when selecting a conversation', async () => {
    const messages = [
      {
        id: 'm-1',
        bot_conversation_id: 'bc-1',
        role: 'user' as const,
        content: 'hi',
        citations: null,
        model: null,
        prompt_tokens: null,
        completion_tokens: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    vi.mocked(getBotMessages).mockResolvedValue(messages);

    await useBotStore.getState().selectConversation('bc-1');

    expect(useBotStore.getState().messages['bc-1']).toEqual(messages);
    expect(useBotStore.getState().loadingMessages).toBe(false);
  });

  it('drops the thread and its messages on delete', async () => {
    useBotStore.setState({
      conversations: [makeConversation('bc-1'), makeConversation('bc-2')],
      activeConversationId: 'bc-1',
      messages: { 'bc-1': [], 'bc-2': [] },
    });
    vi.mocked(deleteBotConversation).mockResolvedValue(undefined);

    await useBotStore.getState().removeConversation('bc-1');

    const state = useBotStore.getState();
    expect(state.conversations.map((c) => c.id)).toEqual(['bc-2']);
    expect(state.messages['bc-1']).toBeUndefined();
    expect(state.activeConversationId).toBeNull();
  });
});
