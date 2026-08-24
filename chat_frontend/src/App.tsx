import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatPage from './pages/ChatPage';
import NotFoundPage from './pages/NotFoundPage';
import { useAuthStore } from './stores/authStore';
import { useThemeStore, applyTheme } from './stores/themeStore';

import type { ReactElement } from 'react';

function RequireAuth({ children }: { children: ReactElement }) {
  const { token } = useAuthStore();
  return token ? children : <Navigate to="/login" replace />;
}

function RedirectIfAuth({ children }: { children: ReactElement }) {
  const { token } = useAuthStore();
  return token ? <Navigate to="/" replace /> : children;
}

export default function App() {
  const { theme } = useThemeStore();

  // Apply theme class to <html> on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<RedirectIfAuth><LoginPage /></RedirectIfAuth>} />
        <Route path="/register" element={<RedirectIfAuth><RegisterPage /></RedirectIfAuth>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <ChatPage />
            </RequireAuth>
          }
        />
        {/* Unguarded on purpose: a wrong URL should say so, for signed-in and
            signed-out visitors alike. The page adapts its CTA to which one. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
