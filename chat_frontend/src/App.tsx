import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
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
        <Route
          path="/"
          element={
            <RequireAuth>
              <ChatPage />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
