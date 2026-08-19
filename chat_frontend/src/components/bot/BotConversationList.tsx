import { useEffect } from 'react';
import {
  ArrowLeftIcon,
  BooksIcon,
  ChatCircleDotsIcon,
  PlusIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useBotStore } from '../../stores/botStore';
import { useThemeStore } from '../../stores/themeStore';
import ThemeToggle from '../ui/ThemeToggle';

interface Props {
  onOpenKnowledgeBase: () => void;
}

export default function BotConversationList({ onOpenKnowledgeBase }: Props) {
  const {
    conversations,
    activeConversationId,
    fetchConversations,
    selectConversation,
    newConversation,
    removeConversation,
    stats,
  } = useBotStore();
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    fetchConversations();
  }, []);

  return (
    <aside
      className="w-72 flex-shrink-0 flex flex-col h-full transition-colors duration-300"
      style={{
        background: isDark ? 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)' : '#ffffff',
        borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}`,
      }}
    >
      <div
        className="px-4 pt-5 pb-4"
        style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <Link
            to="/"
            title="Back to messages"
            className={`flex items-center gap-2 text-sm font-medium transition ${
              isDark ? 'text-white/60 hover:text-white' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ArrowLeftIcon size={16} />
            Messages
          </Link>
          <ThemeToggle />
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2
            className={`text-xs font-semibold uppercase tracking-widest ${
              isDark ? 'text-white/35' : 'text-slate-400'
            }`}
          >
            Assistant
          </h2>
          <button
            onClick={() => newConversation()}
            title="New chat"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition ${
              isDark ? 'text-primary hover:bg-primary/10' : 'text-brand-text hover:bg-primary/15'
            }`}
          >
            <PlusIcon size={14} weight="bold" />
            New chat
          </button>
        </div>

        {isAdmin && (
          <button
            onClick={onOpenKnowledgeBase}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition ${
              isDark
                ? 'bg-white/5 text-white/70 hover:bg-white/10'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <BooksIcon size={15} />
            Knowledge base
            {stats && (
              <span className={`ml-auto ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
                {stats.document_count} doc{stats.document_count === 1 ? '' : 's'}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin py-2">
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-16 px-6 text-center">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 ${
                isDark ? 'bg-white/5' : 'bg-slate-100'
              }`}
            >
              <ChatCircleDotsIcon
                size={28}
                weight="light"
                className={isDark ? 'text-white/20' : 'text-slate-300'}
              />
            </div>
            <p className={`text-sm ${isDark ? 'text-white/30' : 'text-slate-400'}`}>No chats yet</p>
            <p className={`text-xs mt-1 ${isDark ? 'text-white/18' : 'text-slate-300'}`}>
              Ask a question to start one
            </p>
          </div>
        )}

        {conversations.map((conversation) => {
          const isActive = activeConversationId === conversation.id;
          return (
            <div
              key={conversation.id}
              className="group relative flex items-center"
              style={{
                background: isActive
                  ? isDark
                    ? 'rgba(255,255,255,0.10)'
                    : 'rgba(174,226,255,0.18)'
                  : 'transparent',
              }}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-brand-strong rounded-r-full" />
              )}
              <button
                onClick={() => selectConversation(conversation.id)}
                className="flex-1 min-w-0 text-left px-4 py-3"
              >
                <p
                  className={`truncate text-sm ${
                    isActive
                      ? isDark
                        ? 'font-medium text-white'
                        : 'font-medium text-slate-800'
                      : isDark
                        ? 'font-medium text-white/70'
                        : 'font-medium text-slate-600'
                  }`}
                >
                  {conversation.title ?? 'New chat'}
                </p>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
                  {new Date(conversation.updated_at).toLocaleDateString()}
                </p>
              </button>
              <button
                onClick={() => removeConversation(conversation.id)}
                title="Delete chat"
                aria-label={`Delete ${conversation.title ?? 'New chat'}`}
                className={`flex-shrink-0 mr-2 w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition ${
                  isDark
                    ? 'text-white/35 hover:text-red-400 hover:bg-red-400/10'
                    : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                }`}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
