import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../stores/chatStore', () => ({
  useChatStore: vi.fn(),
}));
vi.mock('../../stores/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

import { useChatStore } from '../../stores/chatStore';
import { useThemeStore } from '../../stores/themeStore';
import MessageInput from './MessageInput';

function setup(sendMessage = vi.fn().mockResolvedValue(undefined), sendTyping = vi.fn()) {
  vi.mocked(useChatStore).mockReturnValue({
    activeConversationId: 'conv-1',
    sendMessage,
    sendTyping,
  } as unknown as ReturnType<typeof useChatStore>);
  vi.mocked(useThemeStore).mockReturnValue({ theme: 'light' } as ReturnType<typeof useThemeStore>);
  return { sendMessage, sendTyping };
}

beforeEach(() => {
  setup();
});

describe('MessageInput', () => {
  it('disables the Send button until there is text', async () => {
    render(<MessageInput />);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Type a message...'), 'hi');
    expect(button).not.toBeDisabled();
  });

  it('sends on Enter and clears the textarea', async () => {
    const { sendMessage } = setup();
    render(<MessageInput />);
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText('Type a message...');

    await user.type(textarea, 'hello{Enter}');

    expect(sendMessage).toHaveBeenCalledWith({ conversation_id: 'conv-1', type: 'text', content: 'hello' });
    expect(textarea).toHaveValue('');
  });

  it('does not send on Shift+Enter, allowing a newline instead', async () => {
    const { sendMessage } = setup();
    render(<MessageInput />);
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText('Type a message...');

    await user.type(textarea, 'line1{Shift>}{Enter}{/Shift}line2');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('line1\nline2');
  });

  it('announces typing once for a burst of keystrokes, then stops when the box is cleared', async () => {
    const { sendTyping } = setup();
    render(<MessageInput />);
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText('Type a message...');

    await user.type(textarea, 'hello');
    // One announcement for the whole burst — the heartbeat only re-fires after 2.5s
    expect(sendTyping.mock.calls).toEqual([[true]]);

    await user.clear(textarea);
    expect(sendTyping.mock.calls).toEqual([[true], [false]]);
  });

  it('stops typing when the message is sent', async () => {
    const { sendTyping } = setup();
    render(<MessageInput />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Type a message...'), 'hello{Enter}');

    expect(sendTyping.mock.calls).toEqual([[true], [false]]);
  });

  // Note: a rejected sendMessage is NOT covered here. handleSend's onClick is fire-and-forget
  // (React never awaits/catches an event handler's return value), so a rejection is genuinely
  // unhandled at the Node process level with no reference available from the DOM click to
  // attach a .catch to — there's no way to assert on it without weakening the test runner's
  // unhandled-rejection detection suite-wide. Worth fixing in the component itself (a .catch
  // in handleSend) rather than working around it in tests.
});
