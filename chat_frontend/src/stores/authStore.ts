import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RegisterPayload, User } from '../types';
import { login as apiLogin, register as apiRegister, getMe } from '../api/auth';

interface AuthState {
  token: string | null;
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,

      login: async (username, password) => {
        const { access_token } = await apiLogin({ username, password });
        localStorage.setItem('access_token', access_token);
        set({ token: access_token });
        const user = await getMe();
        set({ user });
      },

      register: async (payload) => {
        await apiRegister(payload);
        // Registration endpoint doesn't return a token, so log in right after.
        const { access_token } = await apiLogin({ username: payload.username, password: payload.password });
        localStorage.setItem('access_token', access_token);
        set({ token: access_token });
        const user = await getMe();
        set({ user });
      },

      logout: () => {
        localStorage.removeItem('access_token');
        set({ token: null, user: null });
      },

      fetchMe: async () => {
        const user = await getMe();
        set({ user });
      },
    }),
    { name: 'auth', partialize: (s) => ({ token: s.token, user: s.user }) }
  )
);
