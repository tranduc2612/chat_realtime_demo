import client from './client';
import type { Message, ReadReceipt, SendMessagePayload } from '../types';

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

export async function getReadReceipts(conversationId: string): Promise<ReadReceipt[]> {
  const { data } = await client.get<ReadReceipt[]>(`/messages/${conversationId}/reads`);
  return data;
}

export async function markRead(conversationId: string, messageId: string): Promise<ReadReceipt> {
  const { data } = await client.post<ReadReceipt>(`/messages/${conversationId}/read`, {
    message_id: messageId,
  });
  return data;
}
