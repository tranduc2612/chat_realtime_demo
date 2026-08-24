import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_TTL_MS, useToastStore } from './toastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toastStore', () => {
  it('adds a toast, defaulting to the success variant', () => {
    useToastStore.getState().showToast('Profile updated successfully');

    expect(useToastStore.getState().toasts).toMatchObject([
      { message: 'Profile updated successfully', variant: 'success' },
    ]);
  });

  it('gives simultaneous toasts distinct ids', () => {
    // Date.now() would collide here, which would break keying and dismissal.
    const first = useToastStore.getState().showToast('one');
    const second = useToastStore.getState().showToast('two');

    expect(first).not.toBe(second);
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it('dismisses itself after the TTL', () => {
    useToastStore.getState().showToast('gone soon');

    vi.advanceTimersByTime(TOAST_TTL_MS - 1);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('cancels the timer when dismissed early, leaving other toasts alone', () => {
    const id = useToastStore.getState().showToast('manual');
    useToastStore.getState().showToast('keeps going');

    useToastStore.getState().dismissToast(id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['keeps going']);

    // The cancelled timer must not fire later and drop the wrong toast.
    vi.advanceTimersByTime(TOAST_TTL_MS);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
