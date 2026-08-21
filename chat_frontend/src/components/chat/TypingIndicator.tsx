import type { TypingUser } from '../../types';
import { useThemeStore } from '../../stores/themeStore';
import { displayName, typingLabel } from './typingLabel';
import Avatar from '../ui/Avatar';

interface Props {
  users: TypingUser[];
  /** Direct chats already name the other person in the header — skip the name there */
  showNames?: boolean;
}

/** Beyond this the stack gets wider than the bubble; the rest become a "+N". */
const MAX_AVATARS = 3;

export default function TypingIndicator({ users, showNames = false }: Props) {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';

  if (users.length === 0) return null;

  // Matches ChatWindow's message-area background, so overlapping avatars read
  // as separate discs instead of merging into one blob
  const pageBg = isDark ? '#0f172a' : '#f0f4f8';
  const shown = users.slice(0, MAX_AVATARS);
  const overflow = users.length - shown.length;

  return (
    <div className="flex justify-start items-end gap-2 mb-1 animate-msg" aria-live="polite">
      <div className="flex items-center flex-shrink-0">
        {shown.map((user, i) => (
          <div
            key={user.user_id}
            title={displayName(user)}
            className={`rounded-full ${i > 0 ? '-ml-3' : ''}`}
            style={{ boxShadow: `0 0 0 2px ${pageBg}` }}
          >
            <Avatar name={displayName(user)} src={user.avatar_url} size="sm" />
          </div>
        ))}
        {overflow > 0 && (
          <span
            className={`-ml-3 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold ${
              isDark ? 'bg-white/10 text-white/60' : 'bg-slate-200 text-slate-500'
            }`}
            style={{ boxShadow: `0 0 0 2px ${pageBg}` }}
          >
            +{overflow}
          </span>
        )}
      </div>

      <div
        className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-bl-sm ${
          isDark
            ? 'bg-white/8 border border-white/8'
            : 'bg-white border border-slate-100 shadow-sm'
        }`}
      >
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-brand-strong/60 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
        <span className={`text-xs italic ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
          {typingLabel(users, showNames)}
        </span>
      </div>
    </div>
  );
}
