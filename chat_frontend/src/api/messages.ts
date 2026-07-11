import client from './client';
import type { Message, SendMessagePayload } from '../types';

export async function sendMessage(payload: SendMessagePayload): Promise<Message> {
  const { data } = await client.post<Message>('/messages/send', payload);
  return data;
}

export async function getMessages(
  conversationId: string,
  params?: { limit?: number; before_id?: string },
): Promise<Message[]> {
  const { data } = await client.get<Message[]>(`/messages/${conversationId}`, { params });
  return data;
}
