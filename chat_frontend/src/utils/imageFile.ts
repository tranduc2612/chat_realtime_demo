/**
 * Client-side avatar checks — a fast "no" before spending an upload.
 *
 * These deliberately mirror the server's rules (app/utils/images.py) rather
 * than replace them: anything here is trivially bypassable, so the server
 * still sniffs the actual bytes. Keeping the limits in one exported constant
 * means the two only have to be kept in step in one place.
 */

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

/** The `accept` attribute for the file input, from the same list. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(',');

/** Returns an error message to show, or null when the file looks usable. */
export function validateImageFile(file: File): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Only JPEG, PNG, GIF and WebP images are allowed';
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return `Image is too large (maximum ${MAX_AVATAR_BYTES / 1024 / 1024}MB)`;
  }
  if (file.size === 0) {
    return 'That file is empty';
  }
  return null;
}
