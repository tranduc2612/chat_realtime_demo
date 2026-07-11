import { useState, useEffect, useRef } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { searchUsers } from '../../api/users';
import { createConversation } from '../../api/conversations';
import { useDebounce } from '../../hooks/useDebounce';
import Avatar from '../ui/Avatar';
import type { User } from '../../types';

interface Props {
  onClose: () => void;
}

export default function CreateGroupModal({ onClose }: Props) {
  const { theme } = useThemeStore();
  const { user: me, token } = useAuthStore();
  const { fetchConversations, setActiveConversation, connectWs } = useChatStore();
  const isDark = theme === 'dark';

  const [groupName, setGroupName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const debouncedQuery = useDebounce(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); return; }
    setSearching(true);
    searchUsers(debouncedQuery)
      .then((users) => setResults(users.filter((u) => u.id !== me?.id && !selected.some((s) => s.id === u.id))))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [debouncedQuery]);

  const toggleSelect = (user: User) => {
    setSelected((prev) =>
      prev.some((s) => s.id === user.id)
        ? prev.filter((s) => s.id !== user.id)
        : [...prev, user]
    );
    setQuery('');
    setResults([]);
  };

  const handleCreate = async () => {
    if (!me) return;
    if (!groupName.trim()) { setError('Please enter a group name'); return; }
    if (selected.length < 2) { setError('Add at least 2 members to create a group'); return; }
    setError('');
    setCreating(true);
    try {
      const conv = await createConversation({
        type: 'group',
        name: groupName.trim(),
        user_ids: selected.map((u) => u.id),
        created_by_id: me.id,
      });
      await fetchConversations();
      setActiveConversation(conv.id);
      if (token) connectWs(conv.id, token);
      onClose();
    } catch {
      setError('Failed to create group. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const surface = isDark ? 'bg-[#1e293b] border-white/10' : 'bg-white border-slate-200';
  const textPrimary = isDark ? 'text-white' : 'text-slate-800';
  const textMuted = isDark ? 'text-white/40' : 'text-slate-400';
  const inputCls = isDark
    ? 'bg-white/8 border-white/12 text-white placeholder-white/30 focus:border-sky-400/60'
    : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-sky-400';
  const dropdownBg = isDark ? 'bg-[#0f172a] border-white/10' : 'bg-white border-slate-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className={`relative w-full max-w-md rounded-2xl border shadow-2xl animate-fade-in ${surface}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/8' : 'border-slate-100'}`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="white" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </div>
            <h2 className={`font-semibold text-base ${textPrimary}`}>New Group</h2>
          </div>
          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${isDark ? 'text-white/40 hover:text-white/70 hover:bg-white/8' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Group name */}
          <div className="space-y-1.5">
            <label className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}>Group Name</label>
            <input
              ref={inputRef}
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Team Alpha, Friends…"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all ${inputCls}`}
            />
          </div>

          {/* Member search */}
          <div className="space-y-1.5">
            <label className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}>
              Add Members <span className={isDark ? 'text-white/20' : 'text-slate-300'}>(min. 2)</span>
            </label>

            {/* Selected chips */}
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selected.map((u) => (
                  <span
                    key={u.id}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition ${
                      isDark ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'bg-sky-100 text-sky-700 border border-sky-200'
                    }`}
                  >
                    <Avatar src={u.avatar_url} name={u.full_name ?? u.username} size="sm" />
                    {u.full_name ?? u.username}
                    <button onClick={() => toggleSelect(u)} className="opacity-60 hover:opacity-100 ml-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${inputCls}`}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-4 h-4 flex-shrink-0 ${textMuted}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users to add…"
                  className={`flex-1 text-sm outline-none bg-transparent ${isDark ? 'text-white placeholder-white/30' : 'text-slate-800 placeholder-slate-400'}`}
                />
                {searching && (
                  <svg className={`animate-spin w-4 h-4 flex-shrink-0 ${textMuted}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
              </div>

              {/* Dropdown */}
              {results.length > 0 && (
                <div className={`absolute left-0 right-0 top-full mt-1 rounded-xl border shadow-xl z-10 overflow-hidden ${dropdownBg}`}>
                  {results.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => toggleSelect(u)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}
                    >
                      <Avatar src={u.avatar_url} name={u.full_name ?? u.username} size="sm" online={u.is_online} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${textPrimary}`}>{u.full_name ?? u.username}</p>
                        <p className={`text-xs truncate ${textMuted}`}>@{u.username}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_online ? 'bg-green-100 text-green-600' : isDark ? 'bg-white/8 text-white/30' : 'bg-slate-100 text-slate-400'}`}>
                        {u.is_online ? 'Online' : 'Offline'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm animate-fade-in ${isDark ? 'bg-red-500/15 border border-red-400/30 text-red-400' : 'bg-red-50 border border-red-200 text-red-500'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between px-6 py-4 border-t ${isDark ? 'border-white/8' : 'border-slate-100'}`}>
          <span className={`text-xs ${textMuted}`}>
            {selected.length} member{selected.length !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${isDark ? 'text-white/50 hover:bg-white/8 hover:text-white/80' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !groupName.trim() || selected.length < 2}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center gap-2"
            >
              {creating ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Creating…
                </>
              ) : 'Create Group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
