import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../stores/authStore', () => ({ useAuthStore: vi.fn() }));
vi.mock('../stores/themeStore', () => ({ useThemeStore: vi.fn() }));

import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import NotFoundPage from './NotFoundPage';

function setup({ token = 'tok-1', path = '/nope' }: { token?: string | null; path?: string } = {}) {
  vi.mocked(useAuthStore).mockReturnValue({ token } as ReturnType<typeof useAuthStore>);
  vi.mocked(useThemeStore).mockReturnValue({ theme: 'light' } as ReturnType<typeof useThemeStore>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFoundPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.title = '';
});

describe('NotFoundPage', () => {
  it('states the problem and shows the path that missed', () => {
    setup({ path: '/conversations/does-not-exist' });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("This page doesn't exist");
    expect(screen.getByText('/conversations/does-not-exist')).toBeInTheDocument();
  });

  it('sends a signed-in visitor back to the chat', async () => {
    setup({ token: 'tok-1' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Back to chat' }));

    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('sends a signed-out visitor to login, since /-with-no-token would bounce back here', async () => {
    setup({ token: null });
    const user = userEvent.setup();

    expect(screen.queryByRole('button', { name: 'Back to chat' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('hides "Go back" when there is no history to go back to', () => {
    // jsdom starts a fresh window with a single history entry, which is exactly
    // the pasted-link case: the button would do nothing, so it must not render
    setup();

    expect(screen.queryByRole('button', { name: /go back/i })).not.toBeInTheDocument();
  });

  it('offers "Go back" once there is history, and walks it back', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    setup();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /go back/i }));

    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('titles the tab while it is open and restores it on the way out', () => {
    document.title = 'Chat';
    const { unmount } = setup();

    expect(document.title).toBe('Page not found');

    unmount();
    expect(document.title).toBe('Chat');
  });
});
