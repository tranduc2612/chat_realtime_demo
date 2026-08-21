export type MessageType = 'text' | 'image' | 'video' | 'file' | 'mixed' | 'system';
export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
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

export interface TypingUser {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface TypingEvent extends TypingUser {
  conversation_id: string;
  is_typing: boolean;
}

/** How far one member has read — a watermark, not a row per message. */
export interface ReadReceipt {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  last_read_message_id: string | null;
}

export interface ReadEvent extends ReadReceipt {
  conversation_id: string;
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
