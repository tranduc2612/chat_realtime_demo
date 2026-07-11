import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import AddMembersModal from './AddMembersModal';
import Avatar from '../ui/Avatar';

export default function ChatWindow() {
  const { activeConversationId, conversations, messages, loadingHistory } = useChatStore();
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showAddMembers, setShowAddMembers] = useState(false);

  const conversation = conversations.find((c) => c.id === activeConversationId);
  const currentMessages = activeConversationId ? (messages[activeConversationId] ?? []) : [];

  const other =
    conversation?.type === 'direct'
      ? conversation.members.find((m) => m.id !== user?.id) ?? conversation.members[0]
      : null;

  const displayName =
    conversation?.type === 'direct'
      ? (other?.full_name ?? other?.username ?? 'Direct Message')
      : (conversation?.name ?? 'Group');

  const displayAvatar =
    conversation?.type === 'direct' ? other?.avatar_url ?? null : conversation?.avatar_url ?? null;

  const isOnline = conversation?.type === 'direct' ? (other?.is_online ?? false) : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length]);

  const bg = isDark ? '#0f172a' : '#f0f4f8';
  const headerBg = isDark ? '#0f172a' : '#ffffff';
  const headerBorder = isDark ? 'rgba(255,255,255,0.05)' : '#e2e8f0';

  if (!activeConversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center transition-colors duration-300" style={{ background: bg }}>
        <div className="relative mb-6">
          <div className={`w-28 h-28 rounded-full flex items-center justify-center ${isDark ? 'bg-sky-500/5' : 'bg-sky-100/60'}`}>
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isDark ? 'bg-sky-500/10' : 'bg-sky-100'}`}>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${isDark ? 'bg-sky-500/15' : 'bg-sky-200/60'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.3} stroke="currentColor" className={`w-7 h-7 ${isDark ? 'text-sky-400/60' : 'text-sky-400'}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <p className={`font-semibold text-lg ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Your messages</p>
        <p className={`text-sm mt-1 ${isDark ? 'text-white/25' : 'text-slate-400'}`}>Select a conversation to start chatting</p>
      </div>
    );
  }

  return (
    <>
    {showAddMembers && conversation?.type === 'group' && (
      <AddMembersModal conversation={conversation} onClose={() => setShowAddMembers(false)} />
    )}
    <div className="flex-1 flex flex-col h-full min-w-0 transition-colors duration-300" style={{ background: bg }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 transition-colors duration-300"
        style={{ background: headerBg, borderBottom: `1px solid ${headerBorder}` }}
      >
        <div className="flex items-center gap-3">
          <Avatar name={displayName} src={displayAvatar} size="md" online={isOnline} />
          <div>
            <p className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-slate-800'}`}>{displayName}</p>
            <p className={`text-xs ${isOnline ? 'text-green-500' : isDark ? 'text-white/30' : 'text-slate-400'}`}>
              {conversation?.type === 'direct'
                ? isOnline ? '● Online' : 'Offline'
                : `${conversation?.members?.length ?? 0} members`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {conversation?.type === 'group' && (
            <button
              onClick={() => setShowAddMembers(true)}
              title="Add members"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                isDark ? 'text-sky-400 hover:bg-sky-400/10' : 'text-sky-600 hover:bg-sky-50'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
              </svg>
              Add
            </button>
          )}
          <button className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${isDark ? 'text-white/35 hover:text-white/70 hover:bg-white/5' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scroll-thin space-y-1" style={{ background: bg }}>
        {loadingHistory[activeConversationId] && (
          <div className="flex justify-center mt-6">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-sky-400/50 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
        {!loadingHistory[activeConversationId] && currentMessages.length === 0 && (
          <div className="flex flex-col items-center mt-16">
            <p className={`text-sm ${isDark ? 'text-white/20' : 'text-slate-400'}`}>No messages yet</p>
            <p className={`text-xs mt-1 ${isDark ? 'text-white/15' : 'text-slate-300'}`}>Say hi! 👋</p>
          </div>
        )}
        {currentMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <MessageInput />
    </div>
    </>
  );
}
