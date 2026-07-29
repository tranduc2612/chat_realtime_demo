import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Message } from '../../types';

vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn(),
}));
vi.mock('../../stores/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import MessageBubble from './MessageBubble';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversation_id: 'conv-1',
    sender_id: 'user-a',
    type: 'text',
    content: 'hello there',
    reply_to_message_id: null,
    is_deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useAuthStore).mockReturnValue({ user: { id: 'user-a' } } as ReturnType<typeof useAuthStore>);
  vi.mocked(useThemeStore).mockReturnValue({ theme: 'light' } as ReturnType<typeof useThemeStore>);
});

describe('MessageBubble', () => {
  it('shows "Message deleted" for deleted messages', () => {
    render(<MessageBubble message={makeMessage({ is_deleted: true })} />);
    expect(screen.getByText('Message deleted')).toBeInTheDocument();
  });

  it('renders the message content', () => {
    render(<MessageBubble message={makeMessage({ content: 'hello there' })} />);
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('renders an image attachment as an img', () => {
    render(
      <MessageBubble
        message={makeMessage({
          content: null,
          attachments: [
            {
              id: 1,
              message_id: 'm1',
              type: 'image',
              url: 'http://x/pic.png',
              thumbnail_url: null,
              file_name: 'pic.png',
              file_size: null,
              mime_type: null,
              width: null,
              height: null,
              duration_seconds: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
        })}
      />
    );
    expect(screen.getByRole('img', { name: 'pic.png' })).toHaveAttribute('src', 'http://x/pic.png');
  });

  it('renders a non-image attachment as a link with a filename fallback', () => {
    render(
      <MessageBubble
        message={makeMessage({
          content: null,
          attachments: [
            {
              id: 2,
              message_id: 'm1',
              type: 'file',
              url: 'http://x/doc.pdf',
              thumbnail_url: null,
              file_name: null,
              file_size: null,
              mime_type: null,
              width: null,
              height: null,
              duration_seconds: null,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
        })}
      />
    );
    const link = screen.getByRole('link', { name: /file/i });
    expect(link).toHaveAttribute('href', 'http://x/doc.pdf');
  });

  it('aligns the bubble based on whether the message is mine', () => {
    const { container: mine } = render(<MessageBubble message={makeMessage({ sender_id: 'user-a' })} />);
    expect(mine.querySelector('.justify-end')).toBeInTheDocument();

    vi.mocked(useAuthStore).mockReturnValue({ user: { id: 'someone-else' } } as ReturnType<typeof useAuthStore>);
    const { container: notMine } = render(<MessageBubble message={makeMessage({ sender_id: 'user-a' })} />);
    expect(notMine.querySelector('.justify-start')).toBeInTheDocument();
  });
});
