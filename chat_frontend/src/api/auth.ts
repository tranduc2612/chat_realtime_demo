import client from './client';
import type { LoginPayload, RegisterPayload, Token, User } from '../types';

export async function login(payload: LoginPayload): Promise<Token> {
  const form = new URLSearchParams();
  form.append('username', payload.username);
  form.append('password', payload.password);
  const { data } = await client.post<Token>('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await client.get<User>('/users/me');
  return data;
}

export async function register(payload: RegisterPayload): Promise<User> {
  const { data } = await client.post<User>('/users/', payload);
  return data;
}
