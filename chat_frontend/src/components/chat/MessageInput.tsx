import { useState, useRef, type KeyboardEvent } from 'react';
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
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
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
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
          </svg>
        </button>

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          aria-label="Send"
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 disabled:opacity-30 hover:from-sky-400 hover:to-indigo-400 active:scale-95 transition-all duration-150 shadow-md shadow-indigo-500/25 mb-0.5"
        >
          {sending ? (
            <svg className="w-3.5 h-3.5 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
              <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
            </svg>
          )}
        </button>
      </div>
      <p className={`text-[10px] text-center mt-2 ${isDark ? 'text-white/15' : 'text-slate-300'}`}>
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}
