import type { ReadReceipt } from '../../types';
import { useThemeStore } from '../../stores/themeStore';
import Avatar from '../ui/Avatar';

interface Props {
  /** Members whose read watermark lands on this message */
  readers: ReadReceipt[];
  /** Direct chats have exactly one possible reader — spell it out instead */
  showLabel?: boolean;
}

/** Beyond this the row gets wider than the bubble it sits under. */
const MAX_AVATARS = 5;

function readerName(reader: ReadReceipt) {
  return reader.full_name ?? reader.username;
}

function seenByLabel(readers: ReadReceipt[]): string {
  return `Seen by ${readers.map(readerName).join(', ')}`;
}

export default function ReadReceipts({ readers, showLabel = false }: Props) {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';

  if (readers.length === 0) return null;

  const shown = readers.slice(0, MAX_AVATARS);
  const overflow = readers.length - shown.length;

  return (
    <div className="flex justify-end items-center gap-1 mb-1 pr-1" title={seenByLabel(readers)}>
      {showLabel && (
        <span className={`text-[10px] mr-0.5 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>Seen</span>
      )}
      {shown.map((reader) => (
        <Avatar key={reader.user_id} name={readerName(reader)} src={reader.avatar_url} size="xs" />
      ))}
      {overflow > 0 && (
        <span className={`text-[10px] ${isDark ? 'text-white/30' : 'text-slate-400'}`}>+{overflow}</span>
      )}
    </div>
  );
}
