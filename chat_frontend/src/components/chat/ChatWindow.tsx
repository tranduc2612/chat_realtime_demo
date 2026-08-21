import { useEffect, useRef, useState } from 'react';
import { ChatsCircleIcon, UserPlusIcon, DotsThreeIcon } from '@phosphor-icons/react';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import AddMembersModal from './AddMembersModal';
import TypingIndicator from './TypingIndicator';
import { typingLabel } from './typingLabel';
import Avatar from '../ui/Avatar';

export default function ChatWindow() {
  const { activeConversationId, conversations, messages, loadingHistory, typing } = useChatStore();
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

  const typingUsers = activeConversationId ? (typing[activeConversationId] ?? []) : [];
  const isGroup = conversation?.type === 'group';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length, typingUsers.length]);

  const bg = isDark ? '#0f172a' : '#f0f4f8';
  const headerBg = isDark ? '#0f172a' : '#ffffff';
  const headerBorder = isDark ? 'rgba(255,255,255,0.05)' : '#e2e8f0';

  if (!activeConversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center transition-colors duration-300" style={{ background: bg }}>
        <div className="relative mb-6">
          <div className={`w-28 h-28 rounded-full flex items-center justify-center ${isDark ? 'bg-primary/5' : 'bg-primary/15'}`}>
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isDark ? 'bg-primary/10' : 'bg-primary/25'}`}>
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${isDark ? 'bg-primary/15' : 'bg-primary/35'}`}>
                <ChatsCircleIcon size={28} weight="light" className={isDark ? 'text-primary/70' : 'text-brand-strong'} />
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
            {typingUsers.length > 0 ? (
              <p className="text-xs italic text-brand-strong">{typingLabel(typingUsers, isGroup)}</p>
            ) : (
              <p className={`text-xs ${isOnline ? 'text-green-500' : isDark ? 'text-white/30' : 'text-slate-400'}`}>
                {conversation?.type === 'direct'
                  ? isOnline ? '● Online' : 'Offline'
                  : `${conversation?.members?.length ?? 0} members`}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {conversation?.type === 'group' && (
            <button
              onClick={() => setShowAddMembers(true)}
              title="Add members"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                isDark ? 'text-primary hover:bg-primary/10' : 'text-brand-text hover:bg-primary/15'
              }`}
            >
              <UserPlusIcon size={14} />
              Add
            </button>
          )}
          <button className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${isDark ? 'text-white/35 hover:text-white/70 hover:bg-white/5' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
            <DotsThreeIcon size={18} weight="bold" />
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
                  className="w-2 h-2 rounded-full bg-brand-strong/50 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
        {!loadingHistory[activeConversationId] && currentMessages.length === 0 && (
          <div className="flex flex-col items-center mt-16">
            <p className={`text-sm ${isDark ? 'text-white/20' : 'text-slate-400'}`}>No messages yet</p>
            <p className={`text-xs mt-1 ${isDark ? 'text-white/15' : 'text-slate-300'}`}>Say hi!</p>
          </div>
        )}
        {currentMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Pinned outside the scroll container, directly above the composer, so it
          stays put whether the conversation is empty or scrolled up through history */}
      {typingUsers.length > 0 && (
        <div className="flex-shrink-0 px-4 pb-1 transition-colors duration-300" style={{ background: bg }}>
          <TypingIndicator users={typingUsers} showNames={isGroup} />
        </div>
      )}

      <MessageInput />
    </div>
    </>
  );
}
