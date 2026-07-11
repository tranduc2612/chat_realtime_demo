import client from './client';
import type { User } from '../types';

export async function searchUsers(q: string): Promise<User[]> {
  const { data } = await client.get<User[]>('/users/search', { params: { q } });
  return data;
}
