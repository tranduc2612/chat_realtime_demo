import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import Avatar from '../ui/Avatar';
import ThemeToggle from '../ui/ThemeToggle';
import UserSearchDropdown from './UserSearchDropdown';
import CreateGroupModal from './CreateGroupModal';
import type { Conversation } from '../../types';

function useConvDisplay(conv: Conversation, myId: string) {
  if (conv.type === 'direct') {
    const other = conv.members.find((m) => m.id !== myId) ?? conv.members[0];
    return {
      name: other?.full_name ?? other?.username ?? 'Direct Message',
      avatar: other?.avatar_url ?? null,
      online: other?.is_online ?? false,
    };
  }
  return {
    name: conv.name ?? 'Group',
    avatar: conv.avatar_url ?? null,
    online: false,
  };
}

export default function ConversationList() {
  const { conversations, activeConversationId, fetchConversations, setActiveConversation, connectWs, unread } =
    useChatStore();
  const { token, user, logout } = useAuthStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  useEffect(() => {
    fetchConversations();
  }, []);

  const handleSelect = (id: string) => {
    setActiveConversation(id);
    if (token) connectWs(id, token);
  };

  const handleLogout = () => {
    logout();
    window.location.replace('/login');
  };

  return (
    <>
    {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} />}
    <aside
      className="w-72 flex-shrink-0 flex flex-col h-full transition-colors duration-300"
      style={{
        background: isDark
          ? 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)'
          : '#ffffff',
        borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}`,
      }}
    >
      {/* Header */}
      <div
        className="px-4 pt-5 pb-4 transition-colors duration-300"
        style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#e2e8f0'}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar name={user?.full_name ?? user?.username} src={user?.avatar_url} size="md" online={true} />
            <div className="min-w-0">
              <p className={`font-semibold text-sm truncate ${isDark ? 'text-white' : 'text-slate-800'}`}>
                {user?.full_name ?? user?.username}
              </p>
              <p className="text-green-500 text-xs flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Online
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <button
              onClick={handleLogout}
              title="Sign out"
              className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 ${
                isDark
                  ? 'text-white/35 hover:text-red-400 hover:bg-red-400/10'
                  : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <h2 className={`text-xs font-semibold uppercase tracking-widest ${isDark ? 'text-white/35' : 'text-slate-400'}`}>
            Messages
          </h2>
          <button
            onClick={() => setShowCreateGroup(true)}
            title="New group"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition ${
              isDark ? 'text-sky-400 hover:bg-sky-400/10' : 'text-sky-600 hover:bg-sky-50'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Group
          </button>
        </div>
        <UserSearchDropdown />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scroll-thin py-2">
        {conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-16 px-6 text-center">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 ${isDark ? 'bg-white/5' : 'bg-slate-100'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-7 h-7 ${isDark ? 'text-white/20' : 'text-slate-300'}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <p className={`text-sm ${isDark ? 'text-white/30' : 'text-slate-400'}`}>No conversations yet</p>
            <p className={`text-xs mt-1 ${isDark ? 'text-white/18' : 'text-slate-300'}`}>Search for someone to start chatting</p>
          </div>
        )}

        {conversations.map((conv) => {
          const display = useConvDisplay(conv, user?.id ?? '');
          const count = unread[conv.id] ?? 0;
          const isActive = activeConversationId === conv.id;

          return (
            <button
              key={conv.id}
              onClick={() => handleSelect(conv.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 relative group"
              style={{
                background: isActive
                  ? isDark ? 'rgba(255,255,255,0.10)' : 'rgba(14,165,233,0.08)'
                  : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
              }}
              onMouseLeave={(e) => {
                if (!isActive)
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {/* Active bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-sky-500 rounded-r-full" />
              )}

              <Avatar name={display.name} src={display.avatar} size="md" online={display.online} />

              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${
                  count > 0
                    ? isDark ? 'font-semibold text-white' : 'font-semibold text-slate-800'
                    : isActive
                      ? isDark ? 'font-medium text-white' : 'font-medium text-slate-800'
                      : isDark ? 'font-medium text-white/70' : 'font-medium text-slate-600'
                }`}>
                  {display.name}
                </p>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
                  {conv.type === 'direct'
                    ? display.online ? '🟢 Online' : 'Offline'
                    : '👥 Group'}
                </p>
              </div>

              {count > 0 && (
                <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-sky-500 text-white text-[11px] font-bold flex items-center justify-center shadow-md shadow-sky-500/30">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
    </>
  );
}
