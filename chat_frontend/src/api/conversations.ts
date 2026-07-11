import client from './client';
import type { Conversation } from '../types';

export async function getConversations(): Promise<Conversation[]> {
  const { data } = await client.get<Conversation[]>('/conversations');
  return data;
}

export async function addMembersToGroup(conversationId: string, userIds: string[]): Promise<Conversation> {
  const { data } = await client.post<Conversation>(`/conversations/${conversationId}/members`, { user_ids: userIds });
  return data;
}

export async function createConversation(payload: {
  type: 'direct' | 'group';
  name?: string;
  avatar_url?: string;
  user_ids: string[];
  created_by_id: string;
}): Promise<Conversation> {
  const { data } = await client.post<Conversation>('/conversations', payload);
  return data;
}
