import { useRef, useState, type KeyboardEvent } from 'react';
import { PaperPlaneTiltIcon, StopIcon } from '@phosphor-icons/react';
import { useBotStore } from '../../stores/botStore';
import { useThemeStore } from '../../stores/themeStore';

export default function BotComposer() {
  const [text, setText] = useState('');
  const { ask, streaming, stopStreaming } = useBotStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    const question = text.trim();
    if (!question || streaming) return;
    setText('');
    await ask(question);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="px-4 py-4 transition-colors duration-300"
      style={{
        background: isDark ? '#0f172a' : '#ffffff',
        borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e2e8f0'}`,
      }}
    >
      <div
        className="flex items-end gap-3 rounded-2xl px-4 py-3 transition-all duration-200"
        style={{
          background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : '#e2e8f0'}`,
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          placeholder="Ask about the internal documents..."
          aria-label="Ask about the internal documents"
          className={`flex-1 resize-none outline-none text-sm max-h-32 py-0.5 bg-transparent transition-colors disabled:opacity-50 ${
            isDark ? 'text-white/90 placeholder-white/25' : 'text-slate-800 placeholder-slate-400'
          }`}
          style={{ overflowY: text.split('\n').length > 4 ? 'auto' : 'hidden' }}
        />

        {streaming ? (
          <button
            onClick={stopStreaming}
            aria-label="Stop generating"
            title="Stop generating"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-red-500/90 text-white hover:bg-red-500 active:scale-95 transition-all duration-150 mb-0.5"
          >
            <StopIcon size={14} weight="fill" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            aria-label="Send"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-30 hover:bg-[#8fd6fc] active:scale-95 transition-all duration-150 mb-0.5"
          >
            <PaperPlaneTiltIcon size={14} weight="fill" />
          </button>
        )}
      </div>

      <p className={`text-[10px] text-center mt-2 ${isDark ? 'text-white/15' : 'text-slate-300'}`}>
        Answers come only from uploaded internal documents · Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
