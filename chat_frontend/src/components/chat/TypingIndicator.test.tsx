import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TypingUser } from '../../types';

vi.mock('../../stores/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

import { useThemeStore } from '../../stores/themeStore';
import TypingIndicator from './TypingIndicator';

function makeUser(overrides: Partial<TypingUser> = {}): TypingUser {
  return {
    user_id: 'user-a',
    username: 'alice',
    full_name: 'Alice',
    avatar_url: 'https://example.com/alice.png',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useThemeStore).mockReturnValue({ theme: 'light' } as ReturnType<typeof useThemeStore>);
});

describe('TypingIndicator', () => {
  it('renders nothing when nobody is typing', () => {
    const { container } = render(<TypingIndicator users={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the avatar of the person typing', () => {
    render(<TypingIndicator users={[makeUser()]} />);

    expect(screen.getByAltText('Alice')).toHaveAttribute('src', 'https://example.com/alice.png');
    expect(screen.getByText('typing...')).toBeInTheDocument();
  });

  it('falls back to the username when there is no full name', () => {
    render(<TypingIndicator users={[makeUser({ full_name: null })]} showNames />);

    expect(screen.getByText('alice is typing...')).toBeInTheDocument();
    expect(screen.getByAltText('alice')).toBeInTheDocument();
  });

  it('names each avatar so hovering identifies who is typing', () => {
    render(<TypingIndicator users={[makeUser(), makeUser({ user_id: 'user-b', full_name: 'Bob' })]} showNames />);

    expect(screen.getByTitle('Alice')).toBeInTheDocument();
    expect(screen.getByTitle('Bob')).toBeInTheDocument();
    expect(screen.getByText('Alice and Bob are typing...')).toBeInTheDocument();
  });

  it('caps the avatar stack and counts the rest', () => {
    const users = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      makeUser({ user_id: `user-${id}`, full_name: id.toUpperCase() })
    );

    render(<TypingIndicator users={users} showNames />);

    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('Several people are typing...')).toBeInTheDocument();
  });
});
