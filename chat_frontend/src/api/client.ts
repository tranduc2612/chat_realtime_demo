import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';
export const WS_BASE = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/api/v1';

const client = axios.create({ baseURL: API_BASE });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      // Clear persisted zustand auth store
      localStorage.removeItem('auth');
      if (window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default client;
