import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProfileUpdatePayload, RegisterPayload, User } from '../types';
import { login as apiLogin, register as apiRegister, getMe } from '../api/auth';
import {
  updateMe as apiUpdateMe,
  uploadAvatar as apiUploadAvatar,
  deleteAvatar as apiDeleteAvatar,
} from '../api/users';

interface AuthState {
  token: string | null;
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  updateProfile: (payload: ProfileUpdatePayload) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
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

      // The three profile actions all return the updated user, so the store
      // takes it straight from the response instead of re-fetching /users/me.
      updateProfile: async (payload) => {
        const user = await apiUpdateMe(payload);
        set({ user });
      },

      uploadAvatar: async (file) => {
        const user = await apiUploadAvatar(file);
        set({ user });
      },

      removeAvatar: async () => {
        const user = await apiDeleteAvatar();
        set({ user });
      },
    }),
    { name: 'auth', partialize: (s) => ({ token: s.token, user: s.user }) }
  )
);
