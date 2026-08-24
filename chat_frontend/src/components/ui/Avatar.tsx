import { useState } from 'react';
import { resolveMediaUrl } from '../../api/client';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  online?: boolean;
}

// xs is for read receipts, where several avatars sit under a message bubble
const sizes = { xs: 'w-4 h-4', sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-14 h-14' };

function Silhouette() {
  return (
    <div className="w-full h-full rounded-full bg-[#e8e9eb] flex items-end justify-center overflow-hidden">
      <svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-[85%] h-[85%]">
        <circle cx="22" cy="16" r="8" fill="#5a5f66" />
        <path d="M4 42 C4 30 40 30 40 42" fill="#5a5f66" />
      </svg>
    </div>
  );
}

export default function Avatar({ src, name, size = 'md', online }: AvatarProps) {
  // Every avatar in the app renders through here, so resolving the stored
  // path to the API origin once at this point covers conversations, read
  // receipts and typing indicators alike.
  const resolved = resolveMediaUrl(src);

  // Remembering *which* URL failed rather than a plain boolean means a new
  // avatar gets a fresh attempt: one broken image would otherwise pin the
  // silhouette in place even after the user uploads a working photo.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <div className={`relative flex-shrink-0 ${sizes[size]}`}>
      {resolved && failedSrc !== resolved ? (
        <img
          src={resolved}
          alt={name ?? ''}
          className="w-full h-full rounded-full object-cover"
          onError={() => setFailedSrc(resolved)}
        />
      ) : (
        <Silhouette />
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${online ? 'bg-green-400' : 'bg-gray-300'}`}
        />
      )}
    </div>
  );
}
