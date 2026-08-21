import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReadReceipt } from '../../types';

vi.mock('../../stores/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

import { useThemeStore } from '../../stores/themeStore';
import ReadReceipts from './ReadReceipts';

function makeReader(overrides: Partial<ReadReceipt> = {}): ReadReceipt {
  return {
    user_id: 'user-b',
    username: 'bob',
    full_name: 'Bob',
    avatar_url: 'https://example.com/bob.png',
    last_read_message_id: 'm1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useThemeStore).mockReturnValue({ theme: 'light' } as ReturnType<typeof useThemeStore>);
});

describe('ReadReceipts', () => {
  it('renders nothing when nobody has read the message', () => {
    const { container } = render(<ReadReceipts readers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an avatar per reader, named for hover', () => {
    render(
      <ReadReceipts readers={[makeReader(), makeReader({ user_id: 'user-c', full_name: 'Carol' })]} />
    );

    expect(screen.getByAltText('Bob')).toBeInTheDocument();
    expect(screen.getByAltText('Carol')).toBeInTheDocument();
    expect(screen.getByTitle('Seen by Bob, Carol')).toBeInTheDocument();
  });

  it('spells out "Seen" for direct chats only', () => {
    const { rerender } = render(<ReadReceipts readers={[makeReader()]} showLabel />);
    expect(screen.getByText('Seen')).toBeInTheDocument();

    rerender(<ReadReceipts readers={[makeReader()]} />);
    expect(screen.queryByText('Seen')).not.toBeInTheDocument();
  });

  it('falls back to the username when a reader has no full name', () => {
    render(<ReadReceipts readers={[makeReader({ full_name: null })]} />);

    expect(screen.getByTitle('Seen by bob')).toBeInTheDocument();
  });

  it('caps the avatar row and counts the rest', () => {
    const readers = ['b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) =>
      makeReader({ user_id: `user-${id}`, full_name: id.toUpperCase() })
    );

    render(<ReadReceipts readers={readers} />);

    expect(screen.getAllByRole('img')).toHaveLength(5);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
