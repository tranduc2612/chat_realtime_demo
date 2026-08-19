import { useEffect, useRef, useState } from 'react';
import { RobotIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { useAuthStore } from '../stores/authStore';
import { useBotStore } from '../stores/botStore';
import { useThemeStore } from '../stores/themeStore';
import BotComposer from '../components/bot/BotComposer';
import BotConversationList from '../components/bot/BotConversationList';
import BotMessageBubble from '../components/bot/BotMessageBubble';
import KnowledgeBasePanel from '../components/bot/KnowledgeBasePanel';

const SUGGESTIONS = [
  'What is the remote work policy?',
  'How do I request time off?',
  'Who approves expense reports?',
];

export default function ChatBotPage() {
  const { user } = useAuthStore();
  const {
    activeConversationId,
    messages,
    loadingMessages,
    error,
    stats,
    clearError,
    fetchStats,
    ask,
  } = useBotStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const thread = activeConversationId ? (messages[activeConversationId] ?? []) : [];

  useEffect(() => {
    fetchStats();
  }, []);

  // Follow the answer as it streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.length, thread[thread.length - 1]?.content]);

  const isEmpty = thread.length === 0 && !loadingMessages;

  return (
    <div className="h-screen flex overflow-hidden">
      {showKnowledgeBase && <KnowledgeBasePanel onClose={() => setShowKnowledgeBase(false)} />}

      <BotConversationList onOpenKnowledgeBase={() => setShowKnowledgeBase(true)} />

      <main className="flex-1 flex flex-col min-w-0" style={{ background: isDark ? '#0f172a' : '#f0f4f8' }}>
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-3.5 flex-shrink-0"
          style={{
            background: isDark ? '#0f172a' : '#ffffff',
            borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}`,
          }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-strong/20">
            <RobotIcon size={20} weight="fill" className="text-brand-text dark:text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-slate-800'}`}>
              Internal Assistant
            </h1>
            <p className={`text-xs ${isDark ? 'text-white/35' : 'text-slate-400'}`}>
              {stats
                ? stats.document_count > 0
                  ? `Grounded in ${stats.document_count} document${stats.document_count === 1 ? '' : 's'} · ${stats.chunk_count} chunks`
                  : 'No documents indexed yet'
                : 'Retrieval-augmented · answers cite their sources'}
            </p>
          </div>
        </header>

        {stats && !stats.vector_store_ready && (
          <div className="px-5 py-2 text-xs flex items-center gap-2 bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <WarningCircleIcon size={14} weight="fill" />
            The document index is unreachable — answers may be unavailable.
          </div>
        )}

        {error && (
          <div className="px-5 py-2 text-xs flex items-center gap-2 bg-red-500/15 text-red-600 dark:text-red-400">
            <WarningCircleIcon size={14} weight="fill" />
            <span className="flex-1">{error}</span>
            <button onClick={clearError} aria-label="Dismiss error" className="hover:opacity-70">
              <XIcon size={13} />
            </button>
          </div>
        )}

        {/* Thread */}
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5 space-y-4">
          {isEmpty ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                  isDark ? 'bg-white/5' : 'bg-white'
                }`}
              >
                <RobotIcon size={32} weight="light" className="text-brand-strong" />
              </div>
              <p className={`text-base font-medium ${isDark ? 'text-white/80' : 'text-slate-700'}`}>
                Hi {user?.full_name ?? user?.username} — ask me anything
              </p>
              <p className={`text-sm mt-1.5 max-w-sm ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
                I answer only from the internal documents that have been uploaded, and I show you
                which ones I used.
              </p>

              <div className="flex flex-wrap gap-2 justify-center mt-6">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => ask(suggestion)}
                    className={`px-3 py-1.5 rounded-xl text-xs transition ${
                      isDark
                        ? 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/90'
                        : 'bg-white text-slate-500 hover:text-slate-700 hover:shadow-sm'
                    }`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            thread.map((message, i) => (
              <BotMessageBubble key={`${message.id}-${i}`} message={message} />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <BotComposer />
      </main>
    </div>
  );
}
