import client from './client';
import type { ProfileUpdatePayload, User } from '../types';

export async function searchUsers(q: string): Promise<User[]> {
  const { data } = await client.get<User[]>('/users/search', { params: { q } });
  return data;
}

export async function updateMe(payload: ProfileUpdatePayload): Promise<User> {
  const { data } = await client.put<User>('/users/me', payload);
  return data;
}

/**
 * Avatars go up as multipart to their own endpoint — the API only stores an
 * avatar_url it produced from bytes it validated, never one a client sent.
 */
export async function uploadAvatar(file: File): Promise<User> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await client.post<User>('/users/me/avatar', form);
  return data;
}

export async function deleteAvatar(): Promise<User> {
  const { data } = await client.delete<User>('/users/me/avatar');
  return data;
}
