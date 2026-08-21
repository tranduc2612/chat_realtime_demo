import { create } from 'zustand';
import type {
  Conversation,
  Message,
  PresenceEvent,
  ReadEvent,
  ReadReceipt,
  TypingEvent,
  TypingUser,
} from '../types';
import { getConversations } from '../api/conversations';
import {
  sendMessage as apiSend,
  getMessages,
  getReadReceipts,
  markRead as apiMarkRead,
} from '../api/messages';
import type { SendMessagePayload } from '../types';
import { WS_BASE } from '../api/client';

/**
 * How long a "user is typing" flag survives without a refresh. The sender
 * re-sends every TYPING_HEARTBEAT_MS while still typing (see MessageInput),
 * so this only fires when their stop event never arrives — tab crashed,
 * network dropped — and stops the indicator from sticking forever.
 */
export const TYPING_TTL_MS = 6000;

// key: `${conversationId}:${userId}` — kept outside the store because timers
// are not state and must not trigger re-renders.
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();


function clearTypingTimer(key: string) {
  const timer = typingTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    typingTimers.delete(key);
  }
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;
  loadingHistory: Record<string, boolean>;
  historyLoaded: Record<string, boolean>;
  unread: Record<string, number>;
  /** conversation_id -> everyone currently typing in it, excluding yourself */
  typing: Record<string, TypingUser[]>;
  /** conversation_id -> every member's read watermark, including your own */
  reads: Record<string, ReadReceipt[]>;
  /** conversation_id -> message id we last reported as read, to collapse repeat calls */
  markedRead: Record<string, string>;
  ws: WebSocket | null;
  userWs: WebSocket | null;

  fetchConversations: () => Promise<void>;
  setActiveConversation: (id: string) => void;
  fetchHistory: (conversationId: string) => Promise<void>;
  sendMessage: (payload: SendMessagePayload) => Promise<void>;
  receiveMessage: (message: Message, fromOther?: boolean) => void;
  receiveTyping: (event: TypingEvent) => void;
  sendTyping: (isTyping: boolean) => void;
  receivePresence: (event: PresenceEvent) => void;
  fetchReads: (conversationId: string) => Promise<void>;
  receiveRead: (event: ReadEvent) => void;
  markRead: (conversationId: string, messageId: string) => Promise<void>;
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
  typing: {},
  reads: {},
  markedRead: {},
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
    // Watermarks move while you're away, so refetch on every open
    get().fetchReads(id);
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
    // Sending a message ends typing — don't wait for the stop event or the TTL
    if (message.sender_id) {
      clearTypingTimer(`${message.conversation_id}:${message.sender_id}`);
    }

    set((state) => {
      const cid = message.conversation_id;
      const existing = state.messages[cid] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;

      const isActive = state.activeConversationId === cid;
      const prevUnread = state.unread[cid] ?? 0;
      const stillTyping = (state.typing[cid] ?? []).filter((u) => u.user_id !== message.sender_id);

      return {
        messages: { ...state.messages, [cid]: [...existing, message] },
        typing: { ...state.typing, [cid]: stillTyping },
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

  receiveTyping: ({ conversation_id: cid, user_id, username, full_name, avatar_url, is_typing }) => {
    const key = `${cid}:${user_id}`;
    clearTypingTimer(key);

    if (is_typing) {
      // Self-expire in case the matching stop event never arrives
      typingTimers.set(
        key,
        setTimeout(() => {
          typingTimers.delete(key);
          get().receiveTyping({
            conversation_id: cid,
            user_id,
            username,
            full_name,
            avatar_url,
            is_typing: false,
          });
        }, TYPING_TTL_MS)
      );
    }

    set((state) => {
      const current = state.typing[cid] ?? [];
      const others = current.filter((u) => u.user_id !== user_id);
      const wasTyping = others.length !== current.length;

      // Already in the desired state — return the same object so subscribers
      // don't re-render on every heartbeat frame
      if (wasTyping === is_typing) return state;

      const next = is_typing ? [...others, { user_id, username, full_name, avatar_url }] : others;
      return { typing: { ...state.typing, [cid]: next } };
    });
  },

  sendTyping: (isTyping) => {
    const { ws, activeConversationId } = get();
    if (!ws || !activeConversationId) return;
    try {
      ws.send(JSON.stringify({ event: 'typing', data: { is_typing: isTyping } }));
    } catch {
      // Socket not open (yet) — typing is best-effort, the next keystroke retries
    }
  },

  receivePresence: ({ user_id, is_online }) => {
    // Presence lives on the member profiles inside each conversation, which is
    // where the sidebar and the chat header already read it from
    set((state) => {
      let changed = false;
      const conversations = state.conversations.map((conv) => {
        if (!conv.members.some((m) => m.id === user_id && m.is_online !== is_online)) return conv;
        changed = true;
        return {
          ...conv,
          members: conv.members.map((m) => (m.id === user_id ? { ...m, is_online } : m)),
        };
      });
      return changed ? { conversations } : state;
    });
  },

  fetchReads: async (conversationId) => {
    try {
      const receipts = await getReadReceipts(conversationId);
      set((s) => ({ reads: { ...s.reads, [conversationId]: receipts } }));
    } catch {
      // Read receipts are decoration — a failure here must not break the chat
    }
  },

  receiveRead: ({ conversation_id: cid, ...receipt }) => {
    set((state) => {
      const current = state.reads[cid] ?? [];
      const others = current.filter((r) => r.user_id !== receipt.user_id);
      return { reads: { ...state.reads, [cid]: [...others, receipt] } };
    });
  },

  markRead: async (conversationId, messageId) => {
    // The server ignores a watermark that doesn't move forward; skip the round
    // trip entirely when we already reported this message
    if (get().markedRead[conversationId] === messageId) return;
    set((s) => ({ markedRead: { ...s.markedRead, [conversationId]: messageId } }));

    try {
      const receipt = await apiMarkRead(conversationId, messageId);
      get().receiveRead({ conversation_id: conversationId, ...receipt });
    } catch {
      // Let the next attempt retry rather than silently pinning the watermark
      set((s) => {
        const markedRead = { ...s.markedRead };
        delete markedRead[conversationId];
        return { markedRead };
      });
    }
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
        else if (evt === 'typing') get().receiveTyping(data as TypingEvent);
        else if (evt === 'message_read') get().receiveRead(data as ReadEvent);
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
        if (evt === 'presence') {
          get().receivePresence(data as PresenceEvent);
          return;
        }
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
