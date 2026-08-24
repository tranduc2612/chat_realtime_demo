import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUUpLeftIcon, ChatsCircleIcon, CompassIcon } from '@phosphor-icons/react';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import ThemeToggle from '../components/ui/ThemeToggle';

export default function NotFoundPage() {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Signed out, "back to chat" would bounce off the auth guard and land here
  // again, so send them where they can actually get in.
  const primary = token
    ? { label: 'Back to chat', to: '/' }
    : { label: 'Sign in', to: '/login' };

  // Opened from a pasted link there is nothing to go back to, and a button
  // that does nothing is worse than no button.
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1;

  useEffect(() => {
    const previous = document.title;
    document.title = 'Page not found';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <main
      className="min-h-[100dvh] flex flex-col transition-colors duration-300"
      style={{ background: isDark ? '#0f172a' : '#f0f4f8' }}
    >
      {/* Same brand mark and toggle placement as the auth pages, so a wrong
          URL still reads as "inside the app" rather than a dead end */}
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: isDark ? 'rgba(174,226,255,0.15)' : '#AEE2FF' }}
        >
          <ChatsCircleIcon weight="fill" size={20} color={isDark ? '#AEE2FF' : '#1a1a2e'} />
        </span>
        <ThemeToggle />
      </header>

      <div className="flex-1 flex items-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-5xl mx-auto grid gap-12 lg:grid-cols-2 lg:gap-16 lg:items-center">
          {/* Copy first in the DOM: on mobile the actions stay above the fold */}
          <div>
            <p
              className="animate-fade-in text-xs font-semibold tracking-[0.2em]"
              style={{ color: isDark ? 'rgba(174,226,255,0.7)' : '#1f6a94' }}
            >
              404
            </p>

            <h1
              className={`animate-fade-in mt-3 text-3xl sm:text-4xl font-bold tracking-tight leading-[1.15] ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
              style={{ animationDelay: '60ms' }}
            >
              This page doesn&apos;t exist
            </h1>

            <p
              className={`animate-fade-in mt-4 text-base leading-relaxed max-w-[46ch] ${
                isDark ? 'text-white/55' : 'text-slate-600'
              }`}
              style={{ animationDelay: '120ms' }}
            >
              The link may be broken, or the page may have moved. Your conversations are still where
              you left them.
            </p>

            <p
              className="animate-fade-in mt-5 inline-flex max-w-full items-center rounded-lg px-3 py-1.5 font-mono text-xs break-all"
              style={{
                animationDelay: '160ms',
                background: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
                color: isDark ? 'rgba(255,255,255,0.55)' : '#475569',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : '#e2e8f0'}`,
              }}
            >
              {pathname}
            </p>

            <div
              className="animate-fade-in mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: '200ms' }}
            >
              <button
                type="button"
                onClick={() => navigate(primary.to)}
                className="py-3 px-5 rounded-xl font-semibold text-sm text-[#1a1a2e] bg-primary hover:bg-[#8fd6fc] outline-none transition-all duration-200 active:scale-[0.98] whitespace-nowrap"
              >
                {primary.label}
              </button>

              {canGoBack && (
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className={`py-3 px-5 rounded-xl font-semibold text-sm outline-none transition-all duration-200 active:scale-[0.98] flex items-center gap-2 whitespace-nowrap ${
                    isDark
                      ? 'text-white/70 hover:text-white hover:bg-white/5'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
                  style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#e2e8f0'}` }}
                >
                  <ArrowUUpLeftIcon size={16} weight="bold" />
                  Go back
                </button>
              )}
            </div>
          </div>

          {/* The concentric-ring motif the empty chat state already uses, so the
              error page belongs to the same family instead of inventing art */}
          <div className="hidden lg:flex justify-center" aria-hidden="true">
            <div
              className={`w-64 h-64 rounded-full flex items-center justify-center ${
                isDark ? 'bg-primary/5' : 'bg-primary/15'
              }`}
            >
              <div
                className={`w-48 h-48 rounded-full flex items-center justify-center ${
                  isDark ? 'bg-primary/10' : 'bg-primary/25'
                }`}
              >
                <div
                  className={`w-32 h-32 rounded-full flex items-center justify-center ${
                    isDark ? 'bg-primary/15' : 'bg-primary/35'
                  }`}
                >
                  <CompassIcon
                    size={56}
                    weight="light"
                    className={isDark ? 'text-primary/70' : 'text-brand-strong'}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
