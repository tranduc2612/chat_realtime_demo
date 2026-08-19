import { create } from 'zustand';
import type { BotConversation, BotMessage, Citation, KnowledgeBaseStats } from '../types';
import {
  askBot,
  createBotConversation,
  deleteBotConversation,
  getBotConversations,
  getBotMessages,
} from '../api/bot';
import { getKnowledgeBaseStats } from '../api/documents';

/** Id used for the assistant bubble while its answer is still streaming. */
const DRAFT_ID = '__draft__';

interface BotState {
  conversations: BotConversation[];
  activeConversationId: string | null;
  messages: Record<string, BotMessage[]>;
  loadingMessages: boolean;
  /** True from the moment a question is sent until the stream closes. */
  streaming: boolean;
  error: string | null;
  stats: KnowledgeBaseStats | null;
  abortController: AbortController | null;

  fetchConversations: () => Promise<void>;
  fetchStats: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => Promise<string | null>;
  removeConversation: (id: string) => Promise<void>;
  ask: (question: string) => Promise<void>;
  stopStreaming: () => void;
  clearError: () => void;
}

function draftMessage(conversationId: string): BotMessage {
  return {
    id: DRAFT_ID,
    bot_conversation_id: conversationId,
    role: 'assistant',
    content: '',
    citations: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    created_at: new Date().toISOString(),
    streaming: true,
  };
}

export const useBotStore = create<BotState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  loadingMessages: false,
  streaming: false,
  error: null,
  stats: null,
  abortController: null,

  fetchConversations: async () => {
    try {
      const conversations = await getBotConversations();
      set({ conversations });
    } catch {
      set({ error: 'Could not load your conversations.' });
    }
  },

  fetchStats: async () => {
    try {
      set({ stats: await getKnowledgeBaseStats() });
    } catch {
      /* Non-fatal: the header just omits the "grounded in N documents" hint. */
    }
  },

  selectConversation: async (id) => {
    set({ activeConversationId: id, loadingMessages: true, error: null });
    try {
      const messages = await getBotMessages(id);
      set((s) => ({ messages: { ...s.messages, [id]: messages }, loadingMessages: false }));
    } catch {
      set({ loadingMessages: false, error: 'Could not load this conversation.' });
    }
  },

  newConversation: async () => {
    try {
      const conversation = await createBotConversation();
      set((s) => ({
        conversations: [conversation, ...s.conversations],
        activeConversationId: conversation.id,
        messages: { ...s.messages, [conversation.id]: [] },
        error: null,
      }));
      return conversation.id;
    } catch {
      set({ error: 'Could not start a new conversation.' });
      return null;
    }
  },

  removeConversation: async (id) => {
    try {
      await deleteBotConversation(id);
      set((s) => {
        const messages = { ...s.messages };
        delete messages[id];
        return {
          conversations: s.conversations.filter((c) => c.id !== id),
          messages,
          activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        };
      });
    } catch {
      set({ error: 'Could not delete that conversation.' });
    }
  },

  ask: async (question) => {
    let conversationId = get().activeConversationId;

    // Asking with nothing selected implicitly opens a thread, so the user can
    // just start typing on an empty page.
    if (!conversationId) {
      conversationId = await get().newConversation();
      if (!conversationId) return;
    }

    const cid = conversationId;
    const optimisticUser: BotMessage = {
      id: `local-${Date.now()}`,
      bot_conversation_id: cid,
      role: 'user',
      content: question,
      citations: null,
      model: null,
      prompt_tokens: null,
      completion_tokens: null,
      created_at: new Date().toISOString(),
    };

    const controller = new AbortController();
    set((s) => ({
      messages: { ...s.messages, [cid]: [...(s.messages[cid] ?? []), optimisticUser, draftMessage(cid)] },
      streaming: true,
      error: null,
      abortController: controller,
    }));

    const patchDraft = (patch: Partial<BotMessage>) =>
      set((s) => ({
        messages: {
          ...s.messages,
          [cid]: (s.messages[cid] ?? []).map((m) => (m.id === DRAFT_ID ? { ...m, ...patch } : m)),
        },
      }));

    try {
      await askBot(
        cid,
        question,
        {
          onCitations: (citations: Citation[]) => patchDraft({ citations }),
          onDelta: (text) =>
            set((s) => ({
              messages: {
                ...s.messages,
                [cid]: (s.messages[cid] ?? []).map((m) =>
                  m.id === DRAFT_ID ? { ...m, content: m.content + text } : m,
                ),
              },
            })),
          onError: (detail) => set({ error: detail }),
          onDone: (info) =>
            patchDraft({
              // Swap the placeholder id for the persisted one, so a later
              // refetch doesn't duplicate the message.
              id: info.message_id ?? DRAFT_ID,
              created_at: info.created_at ?? new Date().toISOString(),
              prompt_tokens: info.prompt_tokens,
              completion_tokens: info.completion_tokens,
              streaming: false,
            }),
        },
        controller.signal,
      );
    } catch (err) {
      // An aborted fetch is the user pressing Stop, not a failure.
      if ((err as Error)?.name !== 'AbortError') {
        set({ error: 'The assistant is unreachable. Please try again.' });
      }
    } finally {
      patchDraft({ streaming: false });
      set({ streaming: false, abortController: null });
      // The title is derived server-side from the first question.
      get().fetchConversations();
    }
  },

  stopStreaming: () => {
    get().abortController?.abort();
    set({ streaming: false, abortController: null });
  },

  clearError: () => set({ error: null }),
}));
