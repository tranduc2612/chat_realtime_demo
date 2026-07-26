import type { ReactNode } from 'react';
import { ChatsCircleIcon, LightningIcon, CheckCircleIcon, UsersThreeIcon, type Icon } from '@phosphor-icons/react';
import { useThemeStore } from '../../stores/themeStore';
import ThemeToggle from '../ui/ThemeToggle';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

const FEATURES: { icon: Icon; label: string }[] = [
  { icon: LightningIcon, label: 'Messages delivered the instant you send them' },
  { icon: CheckCircleIcon, label: 'Read receipts so you know when it lands' },
  { icon: UsersThreeIcon, label: 'Group chats for the whole team' },
];

export default function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';

  return (
    <div className="min-h-[100dvh] lg:grid lg:grid-cols-2" style={{ background: isDark ? '#0f172a' : '#f0f4f8' }}>
      {/* Brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 xl:p-16"
        style={{ background: isDark ? '#0f0c29' : '#AEE2FF' }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: isDark ? 'rgba(174,226,255,0.15)' : 'rgba(26,26,46,0.08)' }}
        >
          <ChatsCircleIcon weight="fill" size={24} color={isDark ? '#AEE2FF' : '#1a1a2e'} />
        </div>

        <div className="max-w-md">
          <h2 className={`text-4xl font-bold tracking-tight leading-[1.15] ${isDark ? 'text-white' : 'text-[#1a1a2e]'}`}>
            Every message arrives the instant you send it.
          </h2>
          <p className={`mt-4 text-base leading-relaxed ${isDark ? 'text-white/60' : 'text-[#1a1a2e]/70'}`}>
            Group chats, read receipts, and file sharing, built for conversations that move as fast as you do.
          </p>

          <ul className="mt-10 space-y-4">
            {FEATURES.map(({ icon: FeatureIcon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: isDark ? 'rgba(174,226,255,0.12)' : 'rgba(26,26,46,0.08)' }}
                >
                  <FeatureIcon weight="bold" size={16} color={isDark ? '#AEE2FF' : '#1a1a2e'} />
                </span>
                <span className={`text-sm ${isDark ? 'text-white/70' : 'text-[#1a1a2e]/80'}`}>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className={`text-xs ${isDark ? 'text-white/30' : 'text-[#1a1a2e]/45'}`}>
          Secure by default. Your conversations stay yours.
        </p>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-col min-h-[100dvh] lg:min-h-0 px-6 py-10 sm:px-12 lg:px-16 lg:py-16">
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
          <ThemeToggle />
        </div>

        {/* Mobile brand mark */}
        <div className="flex lg:hidden mb-10">
          <span
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: isDark ? 'rgba(174,226,255,0.15)' : '#AEE2FF' }}
          >
            <ChatsCircleIcon weight="fill" size={20} color={isDark ? '#AEE2FF' : '#1a1a2e'} />
          </span>
        </div>

        <div className="flex-1 flex flex-col justify-center w-full max-w-sm mx-auto">
          <div className="mb-8 animate-fade-in">
            <h1 className={`text-2xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {title}
            </h1>
            <p className={`text-sm mt-1.5 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{subtitle}</p>
          </div>

          <div className="animate-fade-in">{children}</div>

          <p className={`text-center text-sm mt-6 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{footer}</p>
        </div>
      </div>
    </div>
  );
}
