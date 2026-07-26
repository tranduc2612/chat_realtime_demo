import { PaperclipIcon } from '@phosphor-icons/react';
import type { Message } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';

interface Props {
  message: Message;
}

function formatTime(iso: string) {
  const normalized = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  return new Date(normalized).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ message }: Props) {
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const isMine = message.sender_id === user?.id;

  if (message.is_deleted) {
    return (
      <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1 animate-msg`}>
        <span className={`text-xs italic px-3 py-1.5 rounded-xl ${isDark ? 'text-white/25 bg-white/5' : 'text-slate-400 bg-slate-100'}`}>
          Message deleted
        </span>
      </div>
    );
  }

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1 animate-msg`}>
      <div
        className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl ${
          isMine
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : isDark
              ? 'bg-white/8 text-white/90 rounded-bl-sm border border-white/8'
              : 'bg-white text-slate-800 rounded-bl-sm border border-slate-100 shadow-sm'
        }`}
      >
        {message.content && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        )}

        {message.attachments.map((att) =>
          att.type === 'image' ? (
            <img key={att.id} src={att.url} alt={att.file_name ?? 'image'} className="mt-1.5 rounded-xl max-w-full" />
          ) : (
            <a
              key={att.id}
              href={att.url}
              target="_blank"
              rel="noreferrer"
              className={`mt-1.5 flex items-center gap-1.5 text-xs underline underline-offset-2 ${
                isMine ? 'text-[#1a1a2e]/70' : isDark ? 'text-primary' : 'text-brand-text'
              }`}
            >
              <PaperclipIcon size={12} />
              {att.file_name ?? 'file'}
            </a>
          )
        )}

        <p className={`text-[10px] mt-1.5 select-none ${
          isMine
            ? 'text-[#1a1a2e]/50 text-right'
            : isDark ? 'text-white/30' : 'text-slate-400'
        }`}>
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}
