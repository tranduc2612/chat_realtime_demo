import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '../../types';

vi.mock('../../api/users', () => ({
  updateMe: vi.fn(),
  uploadAvatar: vi.fn(),
  deleteAvatar: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock('../../api/conversations', () => ({ getConversations: vi.fn().mockResolvedValue([]) }));

import { updateMe, uploadAvatar, deleteAvatar } from '../../api/users';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import EditProfileModal from './EditProfileModal';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-a',
    email: 'alice@example.com',
    username: 'alice',
    full_name: 'Alice',
    avatar_url: null,
    is_active: true,
    is_online: true,
    last_seen_at: null,
    ...overrides,
  };
}

const authInitial = useAuthStore.getInitialState();

beforeEach(() => {
  useAuthStore.setState({ ...authInitial, token: 'tok', user: makeUser() }, true);
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
  // jsdom implements neither, and the modal creates one per picked file.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

function pickFile(file: File) {
  const input = screen.getByTestId('avatar-input');
  fireEvent.change(input, { target: { files: [file] } });
}

function imageFile(type = 'image/png', size = 1024, name = 'me.png'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('text fields', () => {
  it('sends only the fields that actually changed', async () => {
    vi.mocked(updateMe).mockResolvedValue(makeUser({ full_name: 'Alice Cooper' }));
    render(<EditProfileModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Alice Cooper' } });
    fireEvent.click(screen.getByText('Save Changes'));

    // Username and email are untouched, so they stay out of the payload —
    // sending them would make a no-op save hit the uniqueness checks.
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ full_name: 'Alice Cooper' }));
  });

  it('sends null to clear the full name', async () => {
    vi.mocked(updateMe).mockResolvedValue(makeUser({ full_name: null }));
    render(<EditProfileModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ full_name: null }));
  });

  it('refuses to save with nothing changed', async () => {
    render(<EditProfileModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Save Changes'));

    expect(await screen.findByText('Nothing to save')).toBeInTheDocument();
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('shows the username as read-only, with no way to edit it', () => {
    render(<EditProfileModal onClose={vi.fn()} />);

    // Visible so people can see who they are signed in as...
    expect(screen.getByText('@alice')).toBeInTheDocument();
    // ...but there is no field to change it — it's the login identifier.
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });

  it("shows the server's message when the email is taken", async () => {
    vi.mocked(updateMe).mockRejectedValue({ response: { data: { detail: 'Email already registered' } } });
    render(<EditProfileModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByText('Save Changes'));

    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
  });

  it('closes the modal and raises a toast once the save succeeds', async () => {
    vi.mocked(updateMe).mockResolvedValue(makeUser({ full_name: 'Alice Cooper' }));
    const onClose = vi.fn();
    render(<EditProfileModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Alice Cooper' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The toast lives in the store (rendered by App), so it survives this
    // component unmounting — which is why it isn't an inline message.
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'Profile updated successfully',
    ]);
  });

  it('stays open and raises no toast when the save fails', async () => {
    vi.mocked(updateMe).mockRejectedValue({ response: { data: { detail: 'Email already registered' } } });
    const onClose = vi.fn();
    render(<EditProfileModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByText('Save Changes'));

    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('password change', () => {
  it('requires the current password and a matching confirmation', async () => {
    render(<EditProfileModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Change password'));

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword1' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Enter your current password')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'mismatch1' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('The two passwords do not match')).toBeInTheDocument();

    expect(updateMe).not.toHaveBeenCalled();
  });

  it('sends both passwords once the form is consistent', async () => {
    vi.mocked(updateMe).mockResolvedValue(makeUser());
    render(<EditProfileModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Change password'));

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'oldpassword1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword1' } });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({ password: 'newpassword1', current_password: 'oldpassword1' }),
    );
  });
});

describe('avatar', () => {
  it('rejects a non-image file without uploading it', async () => {
    render(<EditProfileModal onClose={vi.fn()} />);

    pickFile(imageFile('application/pdf', 1024, 'resume.pdf'));

    expect(await screen.findByText(/Only JPEG, PNG, GIF and WebP/)).toBeInTheDocument();
    expect(screen.queryByText(/New photo selected/)).not.toBeInTheDocument();
  });

  it('rejects an oversized image without uploading it', async () => {
    render(<EditProfileModal onClose={vi.fn()} />);

    pickFile(imageFile('image/png', 6 * 1024 * 1024));

    expect(await screen.findByText(/too large/)).toBeInTheDocument();
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it('previews a valid image and uploads it on save', async () => {
    vi.mocked(uploadAvatar).mockResolvedValue(makeUser({ avatar_url: '/uploads/avatars/new.png' }));
    render(<EditProfileModal onClose={vi.fn()} />);
    const file = imageFile();

    pickFile(file);
    expect(await screen.findByText(/New photo selected/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Alice' })).toHaveAttribute('src', 'blob:preview');

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith(file));
    expect(useAuthStore.getState().user?.avatar_url).toBe('/uploads/avatars/new.png');
  });

  it('does not save the text fields when the upload is rejected server-side', async () => {
    vi.mocked(uploadAvatar).mockRejectedValue({ response: { data: { detail: 'That file is not a valid image' } } });
    render(<EditProfileModal onClose={vi.fn()} />);

    pickFile(imageFile());
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Alice Cooper' } });
    fireEvent.click(screen.getByText('Save Changes'));

    expect(await screen.findByText('That file is not a valid image')).toBeInTheDocument();
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('removes an existing photo', async () => {
    useAuthStore.setState({ user: makeUser({ avatar_url: '/uploads/avatars/old.png' }) });
    vi.mocked(deleteAvatar).mockResolvedValue(makeUser({ avatar_url: null }));

    const onClose = vi.fn();
    render(<EditProfileModal onClose={onClose} />);

    fireEvent.click(screen.getByText('Remove photo'));

    await waitFor(() => expect(deleteAvatar).toHaveBeenCalled());
    expect(useAuthStore.getState().user?.avatar_url).toBeNull();
    // Removing a photo is one step of an unfinished edit, not the end of it.
    expect(onClose).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0]?.message).toBe('Photo removed');
  });

  it('discards a pending selection without calling the API', async () => {
    render(<EditProfileModal onClose={vi.fn()} />);
    pickFile(imageFile());

    fireEvent.click(await screen.findByText('Discard selection'));

    await waitFor(() => expect(screen.queryByText(/New photo selected/)).not.toBeInTheDocument());
    expect(deleteAvatar).not.toHaveBeenCalled();
  });
});
