import type { APIRequestContext } from '@playwright/test';

export const API_BASE = 'http://localhost:8000/api/v1';

export interface TestUser {
  id: string;
  username: string;
  email: string;
  password: string;
}

export function uniqueUsername(prefix = 'e2e'): string {
  // Kept short (~13 chars total): long usernames overflow the sidebar header
  // (a real, separate UI bug — see ConversationList.tsx's header row, which
  // lacks min-w-0 on the name wrapper) and push the Sign out button outside
  // the sidebar's own bounding box, making it unclickable.
  const id = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  return `${prefix}${id}`;
}

/** Registers a brand-new user directly via the API (skips the RegisterPage form). */
export async function registerUser(
  request: APIRequestContext,
  overrides: Partial<{ username: string; password: string }> = {}
): Promise<TestUser> {
  const username = overrides.username ?? uniqueUsername();
  const password = overrides.password ?? 'TestPass123!';
  const email = `${username}@example.com`;

  const res = await request.post(`${API_BASE}/users/`, {
    data: { username, email, password },
  });
  if (!res.ok()) {
    throw new Error(`registerUser failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return { id: body.id, username, email, password };
}

/** Logs in via the API (form-encoded, matching OAuth2PasswordRequestForm) and returns the JWT. */
export async function loginUser(
  request: APIRequestContext,
  username: string,
  password: string
): Promise<string> {
  const res = await request.post(`${API_BASE}/auth/login`, {
    form: { username, password },
  });
  if (!res.ok()) {
    throw new Error(`loginUser failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.access_token as string;
}

/** Creates a direct conversation between two users via the API. */
export async function createDirectConversation(
  request: APIRequestContext,
  token: string,
  createdById: string,
  otherUserId: string
): Promise<string> {
  const res = await request.post(`${API_BASE}/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { type: 'direct', user_ids: [otherUserId], created_by_id: createdById },
  });
  if (!res.ok()) {
    throw new Error(`createDirectConversation failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.id as string;
}
