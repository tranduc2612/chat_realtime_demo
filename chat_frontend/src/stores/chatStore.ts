import { create } from 'zustand';
import type { Conversation, Message } from '../types';
import { getConversations } from '../api/conversations';
import { sendMessage as apiSend, getMessages } from '../api/messages';
import type { SendMessagePayload } from '../types';
import { WS_BASE } from '../api/client';

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  loadingHistory: Record<string, boolean>;
  historyLoaded: Record<string, boolean>;
  unread: Record<string, number>;
  ws: WebSocket | null;
  userWs: WebSocket | null;

  fetchConversations: () => Promise<void>;
  setActiveConversation: (id: string) => void;
  fetchHistory: (conversationId: string) => Promise<void>;
  sendMessage: (payload: SendMessagePayload) => Promise<void>;
  receiveMessage: (message: Message, fromOther?: boolean) => void;
  connectWs: (conversationId: string, token: string) => void;
  disconnectWs: () => void;
  connectUserWs: (token: string) => void;
  disconnectUserWs: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: {},
  loadingHistory: {},
  historyLoaded: {},
  unread: {},
  ws: null,
  userWs: null,

  fetchConversations: async () => {
    const conversations = await getConversations();
    set({ conversations });
  },

  setActiveConversation: (id) => {
    set((s) => ({
      activeConversationId: id,
      unread: { ...s.unread, [id]: 0 },
    }));
    // Always fetch full history if not yet loaded — messages[id] may exist
    // from WS events but only contain recent messages, not the full history
    if (!get().historyLoaded[id]) {
      get().fetchHistory(id);
    }
  },

  fetchHistory: async (conversationId) => {
    set((s) => ({ loadingHistory: { ...s.loadingHistory, [conversationId]: true } }));
    try {
      const fetched = await getMessages(conversationId, { limit: 50 });
      set((s) => {
        // Merge fetched history with any WS messages that arrived in the meantime,
        // deduplicate by id, keep chronological order
        const wsMessages = s.messages[conversationId] ?? [];
        const merged = [...fetched];
        for (const m of wsMessages) {
          if (!merged.some((x) => x.id === m.id)) merged.push(m);
        }
        merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        return {
          messages: { ...s.messages, [conversationId]: merged },
          loadingHistory: { ...s.loadingHistory, [conversationId]: false },
          historyLoaded: { ...s.historyLoaded, [conversationId]: true },
        };
      });
    } catch {
      set((s) => ({ loadingHistory: { ...s.loadingHistory, [conversationId]: false } }));
    }
  },

  sendMessage: async (payload) => {
    const message = await apiSend(payload);
    // Own sent messages never increment unread
    get().receiveMessage(message, false);
  },

  receiveMessage: (message, fromOther = false) => {
    set((state) => {
      const cid = message.conversation_id;
      const existing = state.messages[cid] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;

      const isActive = state.activeConversationId === cid;
      const prevUnread = state.unread[cid] ?? 0;

      return {
        messages: { ...state.messages, [cid]: [...existing, message] },
        conversations: state.conversations
          .map((c) => (c.id === cid ? { ...c, updated_at: message.created_at } : c))
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
        // Only increment when message is from someone else AND the conversation isn't active
        unread: {
          ...state.unread,
          [cid]: fromOther && !isActive ? prevUnread + 1 : prevUnread,
        },
      };
    });
  },

  connectWs: (conversationId, token) => {
    const { ws } = get();
    if (ws) ws.close();

    const socket = new WebSocket(
      `${WS_BASE}/messages/ws/${conversationId}?token=${token}`
    );

    socket.onmessage = (event) => {
      try {
        const { event: evt, data } = JSON.parse(event.data);
        if (evt === 'new_message') get().receiveMessage(data as Message, false);
      } catch {}
    };

    socket.onclose = () => set({ ws: null });
    set({ ws: socket });
  },

  disconnectWs: () => {
    const { ws } = get();
    if (ws) ws.close();
    set({ ws: null });
  },

  connectUserWs: (token) => {
    const { userWs } = get();
    if (userWs) userWs.close();

    const socket = new WebSocket(`${WS_BASE}/messages/ws/user/me?token=${token}`);

    socket.onmessage = (event) => {
      try {
        const { event: evt, data } = JSON.parse(event.data);
        if (evt !== 'new_message') return;
        const message = data as Message;

        // fromOther=true so unread count increments for non-active conversations
        get().receiveMessage(message, true);

        const known = get().conversations.some((c) => c.id === message.conversation_id);
        if (!known) get().fetchConversations();
      } catch {}
    };

    socket.onclose = () => set({ userWs: null });
    set({ userWs: socket });
  },

  disconnectUserWs: () => {
    const { userWs } = get();
    if (userWs) userWs.close();
    set({ userWs: null });
  },
}));
