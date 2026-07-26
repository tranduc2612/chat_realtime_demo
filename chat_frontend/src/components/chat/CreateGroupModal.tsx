import { useState, useEffect, useRef } from 'react';
import { UsersThreeIcon, XIcon, MagnifyingGlassIcon, CircleNotchIcon } from '@phosphor-icons/react';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { searchUsers } from '../../api/users';
import { createConversation } from '../../api/conversations';
import { useDebounce } from '../../hooks/useDebounce';
import Avatar from '../ui/Avatar';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
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
    ? 'bg-white/8 border-white/12 text-white placeholder-white/30 focus:border-primary/60'
    : 'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400 focus:border-primary';
  const dropdownBg = isDark ? 'bg-[#0f172a] border-white/10' : 'bg-white border-slate-200';
  const chipCls = isDark
    ? 'bg-primary/20 text-primary border-primary/30'
    : 'bg-primary/25 text-brand-text border-primary/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className={`relative w-full max-w-md rounded-2xl border shadow-2xl animate-fade-in ${surface}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/8' : 'border-slate-100'}`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <UsersThreeIcon size={16} weight="bold" className="text-primary-foreground" />
            </div>
            <h2 className={`font-semibold text-base ${textPrimary}`}>New Group</h2>
          </div>
          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${isDark ? 'text-white/40 hover:text-white/70 hover:bg-white/8' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
          >
            <XIcon size={16} />
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
              placeholder="e.g. Team Alpha, Friends"
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
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition border ${chipCls}`}
                  >
                    <Avatar src={u.avatar_url} name={u.full_name ?? u.username} size="sm" />
                    {u.full_name ?? u.username}
                    <button onClick={() => toggleSelect(u)} className="opacity-60 hover:opacity-100 ml-0.5">
                      <XIcon size={12} weight="bold" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all ${inputCls}`}>
                <MagnifyingGlassIcon size={16} className={`flex-shrink-0 ${textMuted}`} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users to add..."
                  className={`flex-1 text-sm outline-none bg-transparent ${isDark ? 'text-white placeholder-white/30' : 'text-slate-800 placeholder-slate-400'}`}
                />
                {searching && <CircleNotchIcon size={16} className={`animate-spin flex-shrink-0 ${textMuted}`} />}
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
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_online ? (isDark ? 'bg-green-500/15 text-green-400' : 'bg-green-100 text-green-600') : isDark ? 'bg-white/8 text-white/30' : 'bg-slate-100 text-slate-400'}`}>
                        {u.is_online ? 'Online' : 'Offline'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <Alert message={error} />}
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
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={!groupName.trim() || selected.length < 2}
              loading={creating}
              loadingLabel="Creating..."
            >
              Create Group
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
