import { useState, useEffect, useRef } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { searchUsers } from '../../api/users';
import { createConversation } from '../../api/conversations';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useThemeStore } from '../../stores/themeStore';
import Avatar from '../ui/Avatar';
import type { User } from '../../types';

export default function UserSearchDropdown() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const debouncedQuery = useDebounce(query, 300);
  const { user: me, token } = useAuthStore();
  const { fetchConversations, setActiveConversation, connectWs } = useChatStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    searchUsers(debouncedQuery)
      .then((users) => { setResults(users); setOpen(true); })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (target: User) => {
    if (!me) return;
    setCreating(target.id);
    try {
      const conv = await createConversation({
        type: 'direct',
        user_ids: [target.id],
        created_by_id: me.id,
        name: target.full_name ?? target.username,
      });
      await fetchConversations();
      setActiveConversation(conv.id);
      if (token) connectWs(conv.id, token);
    } finally {
      setCreating(null);
      setQuery('');
      setOpen(false);
    }
  };

  const inputCls = isDark
    ? 'bg-white/8 border-white/12 text-white placeholder-white/30'
    : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400';
  const dropdownCls = isDark
    ? 'bg-[#0f172a] border-white/10 shadow-black/40'
    : 'bg-white border-slate-200 shadow-slate-200';

  return (
    <div ref={containerRef} className="relative">
      <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition focus-within:ring-1 focus-within:ring-sky-400/40 focus-within:border-sky-400/50 ${inputCls}`}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search users…"
          className={`flex-1 text-sm outline-none bg-transparent ${isDark ? 'text-white placeholder-white/30' : 'text-slate-800 placeholder-slate-400'}`}
        />
        {loading && (
          <svg className={`animate-spin w-4 h-4 flex-shrink-0 ${isDark ? 'text-white/30' : 'text-slate-400'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
      </div>

      {open && (
        <div className={`absolute left-0 right-0 top-full mt-1 rounded-xl border shadow-xl z-50 overflow-hidden ${dropdownCls}`}>
          {results.length === 0 ? (
            <p className={`px-4 py-3 text-sm text-center ${isDark ? 'text-white/30' : 'text-slate-400'}`}>No users found</p>
          ) : (
            <ul>
              {results.map((user) => (
                <li key={user.id}>
                  <button
                    onClick={() => handleSelect(user)}
                    disabled={creating === user.id}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition disabled:opacity-60 ${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}
                  >
                    <Avatar src={user.avatar_url} name={user.full_name ?? user.username} size="md" online={user.is_online} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-slate-800'}`}>
                        {user.full_name ?? user.username}
                      </p>
                      <p className={`text-xs truncate ${isDark ? 'text-white/35' : 'text-slate-400'}`}>@{user.username}</p>
                    </div>
                    <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                      user.is_online
                        ? 'bg-green-100 text-green-600'
                        : isDark ? 'bg-white/8 text-white/30' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {user.is_online ? 'Online' : 'Offline'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
