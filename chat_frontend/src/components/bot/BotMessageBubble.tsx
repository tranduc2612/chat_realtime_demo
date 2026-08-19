import { useState } from 'react';
import { FileTextIcon, RobotIcon } from '@phosphor-icons/react';
import { useThemeStore } from '../../stores/themeStore';
import MarkdownLite from './MarkdownLite';
import type { BotMessage } from '../../types';

interface Props {
  message: BotMessage;
}

export default function BotMessageBubble({ message }: Props) {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const [showSources, setShowSources] = useState(false);
  const isUser = message.role === 'user';
  const citations = message.citations ?? [];

  if (isUser) {
    return (
      <div className="flex justify-end animate-msg">
        <div className="max-w-[75%] rounded-2xl rounded-br-md px-4 py-2.5 bg-primary text-primary-foreground">
          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  const isEmptyDraft = message.streaming && !message.content;

  return (
    <div className="flex gap-3 animate-msg">
      <div
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-brand-strong/20"
        aria-hidden
      >
        <RobotIcon size={18} weight="fill" className="text-brand-text dark:text-primary" />
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="inline-block max-w-full rounded-2xl rounded-tl-md px-4 py-2.5 text-sm break-words"
          style={{
            background: isDark ? 'rgba(255,255,255,0.08)' : '#ffffff',
            color: isDark ? 'rgba(255,255,255,0.90)' : '#1e293b',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}`,
          }}
        >
          {isEmptyDraft ? (
            <span className="flex items-center gap-1.5 py-0.5" aria-label="Searching the internal documents">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          ) : (
            <MarkdownLite
              text={message.content}
              onCitationClick={() => setShowSources(true)}
            />
          )}
          {/* Caret while tokens are still arriving */}
          {message.streaming && message.content && (
            <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-current opacity-60 animate-pulse" />
          )}
        </div>

        {citations.length > 0 && !message.streaming && (
          <div className="mt-1.5">
            <button
              onClick={() => setShowSources((v) => !v)}
              className={`text-xs font-medium transition ${
                isDark ? 'text-white/40 hover:text-white/70' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {showSources ? 'Hide' : 'Show'} {citations.length} source
              {citations.length === 1 ? '' : 's'}
            </button>

            {showSources && (
              <div className="mt-2 space-y-1.5 animate-fade-in">
                {citations.map((citation) => (
                  <div
                    key={`${citation.document_id}-${citation.chunk_index}-${citation.index}`}
                    className="rounded-xl px-3 py-2 text-xs"
                    style={{
                      background: isDark ? 'rgba(255,255,255,0.04)' : '#f8fafc',
                      border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}`,
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="flex-shrink-0 w-4 h-4 rounded-full bg-brand-strong/25 text-brand-text dark:text-primary text-[10px] font-bold flex items-center justify-center">
                        {citation.index}
                      </span>
                      <FileTextIcon size={12} className={isDark ? 'text-white/40' : 'text-slate-400'} />
                      <span className={`font-medium truncate ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                        {citation.filename ?? 'Unknown document'}
                      </span>
                      <span className={`ml-auto flex-shrink-0 ${isDark ? 'text-white/25' : 'text-slate-300'}`}>
                        {/* Cosine distance → rough "how close a match" reading */}
                        {(100 - citation.distance * 50).toFixed(0)}% match
                      </span>
                    </div>
                    <p className={`leading-relaxed ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                      {citation.snippet}
                      {citation.snippet.length >= 280 && '…'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
