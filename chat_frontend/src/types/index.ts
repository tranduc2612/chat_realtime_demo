export type MessageType = 'text' | 'image' | 'video' | 'file' | 'mixed' | 'system';
export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean;
  is_online: boolean;
  last_seen_at: string | null;
}

export interface Attachment {
  id: number;
  message_id: string;
  type: 'image' | 'video' | 'file';
  url: string;
  thumbnail_url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  type: MessageType;
  content: string | null;
  reply_to_message_id: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  attachments: Attachment[];
}

export interface ConversationMemberProfile {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  is_online: boolean;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  avatar_url: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
  members: ConversationMemberProfile[];
}

export interface SendMessagePayload {
  conversation_id: string;
  type: MessageType;
  content?: string;
  reply_to_message_id?: string;
  attachments?: Omit<Attachment, 'id' | 'message_id' | 'created_at'>[];
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  full_name?: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

/* ── RAG chatbot (/chat-bot) ────────────────────────────────────────────── */

export type BotMessageRole = 'user' | 'assistant';
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';

/** One internal-document chunk that grounded an answer. */
export interface Citation {
  index: number;
  document_id: string | null;
  filename: string | null;
  chunk_index: number | null;
  snippet: string;
  /** Cosine distance from the question — 0 is an exact match. */
  distance: number;
}

export interface BotMessage {
  id: string;
  bot_conversation_id: string;
  role: BotMessageRole;
  content: string;
  citations: Citation[] | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  created_at: string;
  /** Client-side only: set while the answer is still streaming in. */
  streaming?: boolean;
}

export interface BotConversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocument {
  id: string;
  filename: string;
  mime_type: string | null;
  file_size: number;
  status: DocumentStatus;
  chunk_count: number;
  error: string | null;
  uploaded_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseStats {
  document_count: number;
  chunk_count: number;
  vector_store_ready: boolean;
}
