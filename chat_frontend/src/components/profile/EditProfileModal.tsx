import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UserCircleIcon,
  XIcon,
  CameraIcon,
  TrashIcon,
  LockKeyIcon,
} from '@phosphor-icons/react';
import { useThemeStore } from '../../stores/themeStore';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useToastStore } from '../../stores/toastStore';
import { resolveMediaUrl } from '../../api/client';
import { IMAGE_ACCEPT_ATTR, MAX_AVATAR_BYTES, validateImageFile } from '../../utils/imageFile';
import Avatar from '../ui/Avatar';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import type { ProfileUpdatePayload } from '../../types';

interface Props {
  onClose: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  // FastAPI puts the translated message in `detail`; anything else (network
  // error, 500 with no body) falls back to the caller's generic wording.
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

export default function EditProfileModal({ onClose }: Props) {
  const { theme } = useThemeStore();
  const { user, updateProfile, uploadAvatar, removeAvatar } = useAuthStore();
  const { fetchConversations } = useChatStore();
  const showToast = useToastStore((s) => s.showToast);
  const isDark = theme === 'dark';

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePassword, setChangePassword] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  // Object URLs are a manual allocation: without the revoke, every re-pick
  // leaks the previous blob for the lifetime of the tab.
  const preview = useMemo(
    () => (pendingFile ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  );
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always clear the input: picking the same file twice in a row otherwise
    // fires no change event, so a rejected file could never be re-selected.
    e.target.value = '';
    if (!file) return;

    const problem = validateImageFile(file);
    if (problem) { setError(problem); setPendingFile(null); return; }

    setError('');
    setPendingFile(file);
  };

  const handleRemoveAvatar = async () => {
    setPendingFile(null);
    if (!user?.avatar_url) return;
    setError('');
    setSaving(true);
    try {
      await removeAvatar();
      await fetchConversations();
      // Stays open: removing a photo is one step of an edit that isn't
      // finished yet, unlike Save.
      showToast('Photo removed');
    } catch (err) {
      setError(errorMessage(err, 'Could not remove your photo. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const buildPayload = (): ProfileUpdatePayload | null => {
    const payload: ProfileUpdatePayload = {};
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();

    // Only send what actually changed — the API treats an absent key as
    // "leave it alone", which keeps a no-op save from tripping the uniqueness
    // check on your own email.
    if (trimmedName !== (user?.full_name ?? '')) payload.full_name = trimmedName || null;
    if (trimmedEmail !== user?.email) payload.email = trimmedEmail;
    if (changePassword && newPassword) {
      payload.password = newPassword;
      payload.current_password = currentPassword;
    }
    return Object.keys(payload).length ? payload : null;
  };

  const handleSave = async () => {
    setError('');

    if (!email.trim()) { setError('Email cannot be empty'); return; }
    if (changePassword) {
      if (!currentPassword) { setError('Enter your current password'); return; }
      if (newPassword.length < 8) { setError('New password must be at least 8 characters'); return; }
      if (newPassword !== confirmPassword) { setError('The two passwords do not match'); return; }
    }

    const payload = buildPayload();
    if (!payload && !pendingFile) { setError('Nothing to save'); return; }

    setSaving(true);
    try {
      // Avatar first: it's the change most likely to be rejected (size, real
      // file type), and failing it shouldn't silently leave the text fields
      // half-saved.
      if (pendingFile) {
        await uploadAvatar(pendingFile);
        setPendingFile(null);
      }
      if (payload) await updateProfile(payload);

      // The sidebar reads names and avatars off conversation members, which
      // carry their own copy of your profile from the last fetch.
      await fetchConversations();

      // Confirmation is a toast rather than an inline message because the
      // modal is gone by the time it shows — it's raised from App, above
      // this component, so closing here doesn't take it with us.
      showToast('Profile updated successfully');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save your changes. Please try again.'));
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

  const displayName = user?.full_name ?? user?.username ?? '';
  const shownAvatar = preview ?? resolveMediaUrl(user?.avatar_url) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div
        role="dialog"
        aria-label="Edit profile"
        className={`relative w-full max-w-md rounded-2xl border shadow-2xl animate-fade-in ${surface}`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-white/8' : 'border-slate-100'}`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
              <UserCircleIcon size={16} weight="bold" className="text-primary-foreground" />
            </div>
            <h2 className={`font-semibold text-base ${textPrimary}`}>Edit Profile</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close profile"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${isDark ? 'text-white/40 hover:text-white/70 hover:bg-white/8' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto scroll-thin">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar src={shownAvatar} name={displayName} size="lg" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Change photo"
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-[#8fd6fc] transition"
              >
                <CameraIcon size={14} weight="bold" />
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium truncate ${textPrimary}`}>{displayName}</p>
              <p className={`text-xs ${textMuted}`}>
                JPEG, PNG, GIF or WebP · up to {MAX_AVATAR_BYTES / 1024 / 1024}MB
              </p>
              {(user?.avatar_url || pendingFile) && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition"
                >
                  <TrashIcon size={12} />
                  {pendingFile ? 'Discard selection' : 'Remove photo'}
                </button>
              )}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              onChange={handlePick}
              className="hidden"
              data-testid="avatar-input"
            />
          </div>

          {pendingFile && (
            <p className={`text-xs ${textMuted}`}>
              New photo selected — press Save to upload it.
            </p>
          )}

          {/* Text fields */}
          <div className="space-y-1.5">
            <label htmlFor="profile-full-name" className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}>Full Name</label>
            <input
              id="profile-full-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your display name"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all ${inputCls}`}
            />
          </div>

          {/* Shown but not editable: the username is the login identifier,
              so changing it would invalidate what people (and their password
              managers) type at the sign-in form. */}
          <div className="space-y-1.5">
            <span className={`block text-xs font-semibold uppercase tracking-wider ${textMuted}`}>Username</span>
            <div
              className={`flex items-center justify-between gap-2 w-full px-4 py-2.5 rounded-xl border text-sm ${
                isDark ? 'bg-white/4 border-white/8' : 'bg-slate-100 border-slate-200'
              }`}
            >
              <span className={textMuted}>@{user?.username}</span>
              <span className={`text-xs ${isDark ? 'text-white/25' : 'text-slate-400'}`}>
                Used to sign in — can't be changed
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="profile-email" className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}>Email</label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all ${inputCls}`}
            />
          </div>

          {/* Password */}
          {!changePassword ? (
            <button
              type="button"
              onClick={() => setChangePassword(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium transition ${isDark ? 'text-primary hover:text-white' : 'text-brand-text hover:text-slate-800'}`}
            >
              <LockKeyIcon size={14} />
              Change password
            </button>
          ) : (
            <div className={`space-y-3 rounded-xl border p-3 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase tracking-wider ${textMuted}`}>Change Password</span>
                <button
                  type="button"
                  onClick={() => {
                    setChangePassword(false);
                    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
                  }}
                  className={`text-xs ${textMuted} hover:underline`}
                >
                  Cancel
                </button>
              </div>
              <input
                type="password"
                aria-label="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                autoComplete="current-password"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all ${inputCls}`}
              />
              <input
                type="password"
                aria-label="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min. 8 characters)"
                autoComplete="new-password"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all ${inputCls}`}
              />
              <input
                type="password"
                aria-label="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all ${inputCls}`}
              />
            </div>
          )}

          {error && <Alert message={error} />}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-2 px-6 py-4 border-t ${isDark ? 'border-white/8' : 'border-slate-100'}`}>
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${isDark ? 'text-white/50 hover:bg-white/8 hover:text-white/80' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
          >
            Close
          </button>
          <Button type="button" size="sm" onClick={handleSave} loading={saving} loadingLabel="Saving...">
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
