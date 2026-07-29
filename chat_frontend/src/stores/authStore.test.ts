import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types';

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  getMe: vi.fn(),
}));

import { login as apiLogin, register as apiRegister, getMe } from '../api/auth';
import { useAuthStore } from './authStore';

const initialState = useAuthStore.getInitialState();

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-a',
    email: 'a@example.com',
    username: 'alice',
    full_name: 'Alice',
    avatar_url: null,
    is_active: true,
    is_online: false,
    last_seen_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  useAuthStore.setState(initialState, true);
  vi.clearAllMocks();
  localStorage.clear();
});

describe('login', () => {
  it('calls the login API then getMe, sets token and user, and persists access_token', async () => {
    vi.mocked(apiLogin).mockResolvedValue({ access_token: 'tok-123', token_type: 'bearer' });
    const user = makeUser();
    vi.mocked(getMe).mockResolvedValue(user);

    await useAuthStore.getState().login('alice', 'password1');

    expect(apiLogin).toHaveBeenCalledWith({ username: 'alice', password: 'password1' });
    expect(getMe).toHaveBeenCalled();
    expect(useAuthStore.getState().token).toBe('tok-123');
    expect(useAuthStore.getState().user).toEqual(user);
    expect(localStorage.getItem('access_token')).toBe('tok-123');
  });
});

describe('logout', () => {
  it('clears token, user, and access_token from localStorage', () => {
    useAuthStore.setState({ token: 'tok-123', user: makeUser() });
    localStorage.setItem('access_token', 'tok-123');

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });
});

describe('register', () => {
  it('registers, then logs in, then fetches the current user, in that order', async () => {
    const calls: string[] = [];
    vi.mocked(apiRegister).mockImplementation(async () => {
      calls.push('register');
      return makeUser();
    });
    vi.mocked(apiLogin).mockImplementation(async () => {
      calls.push('login');
      return { access_token: 'tok-456', token_type: 'bearer' };
    });
    vi.mocked(getMe).mockImplementation(async () => {
      calls.push('getMe');
      return makeUser();
    });

    await useAuthStore.getState().register({
      email: 'a@example.com',
      username: 'alice',
      password: 'password1',
    });

    expect(calls).toEqual(['register', 'login', 'getMe']);
    expect(useAuthStore.getState().token).toBe('tok-456');
  });
});
