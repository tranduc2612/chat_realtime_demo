import { useState, useRef, type KeyboardEvent } from 'react';
import { SmileyIcon, PaperclipIcon, PaperPlaneTiltIcon, CircleNotchIcon } from '@phosphor-icons/react';
import { useChatStore } from '../../stores/chatStore';
import { useThemeStore } from '../../stores/themeStore';

export default function MessageInput() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const { activeConversationId, sendMessage } = useChatStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !activeConversationId || sending) return;

    setSending(true);
    try {
      await sendMessage({ conversation_id: activeConversationId, type: 'text', content });
      setText('');
      textareaRef.current?.focus();
    } finally {
      setSending(false);
    }
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
        {/* Emoji */}
        <button
          type="button"
          tabIndex={-1}
          className={`flex-shrink-0 w-6 h-6 flex items-center justify-center transition mb-0.5 ${
            isDark ? 'text-white/30 hover:text-white/60' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <SmileyIcon size={20} />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className={`flex-1 resize-none outline-none text-sm max-h-32 py-0.5 bg-transparent transition-colors ${
            isDark ? 'text-white/90 placeholder-white/25' : 'text-slate-800 placeholder-slate-400'
          }`}
          style={{ overflowY: text.split('\n').length > 4 ? 'auto' : 'hidden' }}
        />

        {/* Attachment */}
        <button
          type="button"
          tabIndex={-1}
          className={`flex-shrink-0 w-6 h-6 flex items-center justify-center transition mb-0.5 ${
            isDark ? 'text-white/30 hover:text-white/60' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <PaperclipIcon size={20} />
        </button>

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          aria-label="Send"
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-30 hover:bg-[#8fd6fc] active:scale-95 transition-all duration-150 mb-0.5"
        >
          {sending ? (
            <CircleNotchIcon size={14} className="animate-spin" />
          ) : (
            <PaperPlaneTiltIcon size={14} weight="fill" />
          )}
        </button>
      </div>
      <p className={`text-[10px] text-center mt-2 ${isDark ? 'text-white/15' : 'text-slate-300'}`}>
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
