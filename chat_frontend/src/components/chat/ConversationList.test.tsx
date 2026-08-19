import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Conversation } from '../../types';

vi.mock('../../stores/chatStore', () => ({ useChatStore: vi.fn() }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: vi.fn() }));
vi.mock('../../stores/themeStore', () => ({ useThemeStore: vi.fn() }));
vi.mock('./UserSearchDropdown', () => ({ default: () => <div data-testid="user-search-stub" /> }));
vi.mock('./CreateGroupModal', () => ({ default: () => <div data-testid="create-group-stub" /> }));

import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import ConversationList from './ConversationList';

/** ConversationList renders a <Link> to /chat-bot, which needs a router. */
function renderList() {
  return render(
    <MemoryRouter>
      <ConversationList />
    </MemoryRouter>,
  );
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    type: 'direct',
    name: null,
    avatar_url: null,
    created_by_id: 'user-a',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    members: [{ id: 'user-b', username: 'bob', full_name: 'Bob', avatar_url: null, is_online: true }],
    ...overrides,
  };
}

function setup(overrides: Partial<{ conversations: Conversation[]; activeConversationId: string | null; unread: Record<string, number> }> = {}) {
  const fetchConversations = vi.fn();
  const setActiveConversation = vi.fn();
  const connectWs = vi.fn();
  const logout = vi.fn();

  vi.mocked(useChatStore).mockReturnValue({
    conversations: [],
    activeConversationId: null,
    fetchConversations,
    setActiveConversation,
    connectWs,
    unread: {},
    ...overrides,
  } as unknown as ReturnType<typeof useChatStore>);
  vi.mocked(useAuthStore).mockReturnValue({
    token: 'tok-123',
    user: { id: 'user-a', username: 'alice', full_name: 'Alice' },
    logout,
  } as unknown as ReturnType<typeof useAuthStore>);
  vi.mocked(useThemeStore).mockReturnValue({ theme: 'light' } as ReturnType<typeof useThemeStore>);

  return { fetchConversations, setActiveConversation, connectWs, logout };
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, replace: vi.fn() },
    writable: true,
  });
});

describe('ConversationList', () => {
  it('fetches conversations once on mount', () => {
    const { fetchConversations } = setup();
    renderList();
    expect(fetchConversations).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when there are no conversations', () => {
    setup({ conversations: [] });
    renderList();
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('selects a conversation and connects the websocket when a token exists', () => {
    const { setActiveConversation, connectWs } = setup({
      conversations: [makeConversation({ id: 'conv-1' })],
    });
    renderList();

    fireEvent.click(screen.getByText('Bob'));

    expect(setActiveConversation).toHaveBeenCalledWith('conv-1');
    expect(connectWs).toHaveBeenCalledWith('conv-1', 'tok-123');
  });

  it('shows the unread count, capped at "99+"', () => {
    setup({
      conversations: [makeConversation({ id: 'conv-1' })],
      unread: { 'conv-1': 150 },
    });
    renderList();
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('logs out and navigates when the sign-out button is clicked', () => {
    const { logout } = setup();
    renderList();

    fireEvent.click(screen.getByTitle('Sign out'));

    expect(logout).toHaveBeenCalled();
    expect(window.location.replace).toHaveBeenCalledWith('/login');
  });
});
