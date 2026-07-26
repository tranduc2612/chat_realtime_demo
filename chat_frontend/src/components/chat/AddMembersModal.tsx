import { useState, useEffect } from 'react';
import { XIcon, MagnifyingGlassIcon, CircleNotchIcon } from '@phosphor-icons/react';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { searchUsers } from '../../api/users';
import { addMembersToGroup } from '../../api/conversations';
import { useDebounce } from '../../hooks/useDebounce';
import Avatar from '../ui/Avatar';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import type { Conversation, User } from '../../types';

interface Props {
  conversation: Conversation;
  onClose: () => void;
}

export default function AddMembersModal({ conversation, onClose }: Props) {
  const { theme } = useThemeStore();
  const { user: me } = useAuthStore();
  const { fetchConversations } = useChatStore();
  const isDark = theme === 'dark';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const debouncedQuery = useDebounce(query, 300);
  const existingIds = new Set(conversation.members.map((m) => m.id));

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); return; }
    setSearching(true);
    searchUsers(debouncedQuery)
      .then((users) =>
        setResults(
          users.filter((u) => !existingIds.has(u.id) && u.id !== me?.id && !selected.some((s) => s.id === u.id))
        )
      )
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [debouncedQuery]);

  const toggleSelect = (user: User) => {
    setSelected((prev) =>
      prev.some((s) => s.id === user.id) ? prev.filter((s) => s.id !== user.id) : [...prev, user]
    );
    setQuery('');
    setResults([]);
  };

  const handleAdd = async () => {
    if (selected.length === 0) { setError('Select at least one member to add'); return; }
    setError('');
    setSaving(true);
    try {
      await addMembersToGroup(conversation.id, selected.map((u) => u.id));
      await fetchConversations();
      setSuccess(true);
      setTimeout(onClose, 900);
    } catch {
      setError('Failed to add members. Please try again.');
    } finally {
      setSaving(false);
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
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className={`relative w-full max-w-md rounded-2xl border shadow-2xl animate-fade-in ${surface}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/8' : 'border-slate-100'}`}>
          <div>
            <h2 className={`font-semibold text-base ${textPrimary}`}>Add Members</h2>
            <p className={`text-xs mt-0.5 ${textMuted}`}>{conversation.name}</p>
          </div>
          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${isDark ? 'text-white/40 hover:text-white/70 hover:bg-white/8' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Current members */}
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${textMuted}`}>
              Current Members ({conversation.members.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {conversation.members.map((m) => (
                <span key={m.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${isDark ? 'bg-white/6 text-white/50' : 'bg-slate-100 text-slate-500'}`}>
                  <Avatar src={m.avatar_url} name={m.full_name ?? m.username} size="sm" />
                  {m.full_name ?? m.username}
                </span>
              ))}
            </div>
          </div>

          {/* Selected to add */}
          {selected.length > 0 && (
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${textMuted}`}>Adding</p>
              <div className="flex flex-wrap gap-1.5">
                {selected.map((u) => (
                  <span key={u.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${chipCls}`}>
                    <Avatar src={u.avatar_url} name={u.full_name ?? u.username} size="sm" />
                    {u.full_name ?? u.username}
                    <button onClick={() => toggleSelect(u)} className="opacity-60 hover:opacity-100 ml-0.5">
                      <XIcon size={12} weight="bold" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
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
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <Alert message={error} />}
          {success && <Alert variant="success" message="Members added successfully!" />}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between px-6 py-4 border-t ${isDark ? 'border-white/8' : 'border-slate-100'}`}>
          <span className={`text-xs ${textMuted}`}>
            {selected.length} new member{selected.length !== 1 ? 's' : ''} to add
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
              onClick={handleAdd}
              disabled={selected.length === 0 || success}
              loading={saving}
              loadingLabel="Adding..."
            >
              Add Members
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
