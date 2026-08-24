import axios from 'axios';

// Two backends, two ports: the HTTP API (chat_with_fastapi) and the WebSocket
// service (chat_with_fastapi_ws) are separate deployments.
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';
export const WS_BASE = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8001/api/v1';

/**
 * Turn a stored media URL into something an <img src> can fetch.
 *
 * The API stores avatars as root-relative paths ("/uploads/avatars/x.png")
 * because it serves them itself, and the frontend runs on a different origin
 * (5173 vs 8000), where that path would resolve to the Vite dev server. An
 * absolute URL is returned untouched — which is exactly what the move to S3
 * will start storing, so nothing here changes on that day.
 */
export function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    // Resolves relative paths against the API origin and returns absolute
    // URLs unchanged. Throws only if API_BASE itself is relative (a
    // same-origin deployment), where the stored path already works as-is.
    return new URL(url, API_BASE).href;
  } catch {
    return url;
  }
}

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
