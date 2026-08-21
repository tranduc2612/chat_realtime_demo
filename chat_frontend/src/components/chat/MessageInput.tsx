import { useCallback, useEffect, useState, useRef, type KeyboardEvent } from 'react';
import { SmileyIcon, PaperclipIcon, PaperPlaneTiltIcon, CircleNotchIcon } from '@phosphor-icons/react';
import { useChatStore } from '../../stores/chatStore';
import { useThemeStore } from '../../stores/themeStore';

/** Don't re-announce "still typing" more often than this while keys keep coming. */
const TYPING_HEARTBEAT_MS = 2500;
/** Announce "stopped typing" after this long without a keystroke. */
const TYPING_IDLE_MS = 2500;

export default function MessageInput() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const { activeConversationId, sendMessage, sendTyping } = useChatStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isTypingRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (!isTypingRef.current) return;
    isTypingRef.current = false;
    lastSentAtRef.current = 0;
    sendTyping(false);
  }, [sendTyping]);

  const handleChange = (value: string) => {
    setText(value);

    if (!value.trim()) {
      stopTyping();
      return;
    }

    const now = Date.now();
    if (!isTypingRef.current || now - lastSentAtRef.current >= TYPING_HEARTBEAT_MS) {
      isTypingRef.current = true;
      lastSentAtRef.current = now;
      sendTyping(true);
    }

    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  // Switching conversations closes the old socket, and the backend broadcasts
  // the stop on disconnect — so just drop local state, don't send on the new one
  useEffect(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    isTypingRef.current = false;
    lastSentAtRef.current = 0;
  }, [activeConversationId]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !activeConversationId || sending) return;

    stopTyping();
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
          onChange={(e) => handleChange(e.target.value)}
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
