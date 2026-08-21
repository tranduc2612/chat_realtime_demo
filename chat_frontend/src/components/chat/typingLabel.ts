import type { TypingUser } from '../../types';

export function displayName(user: TypingUser) {
  return user.full_name ?? user.username;
}

/**
 * `showNames` is for groups — a direct chat already names the other person in
 * the header, so repeating it there reads as noise.
 */
export function typingLabel(users: TypingUser[], showNames: boolean): string {
  if (!showNames) return 'typing...';
  if (users.length === 1) return `${displayName(users[0])} is typing...`;
  if (users.length === 2) return `${displayName(users[0])} and ${displayName(users[1])} are typing...`;
  return 'Several people are typing...';
}
