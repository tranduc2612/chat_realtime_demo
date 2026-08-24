import { create } from 'zustand';

export type ToastVariant = 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

/** How long a toast stays on screen before dismissing itself. */
export const TOAST_TTL_MS = 3500;

interface ToastState {
  toasts: Toast[];
  /** Shows a toast and returns its id, so a caller can dismiss it early. */
  showToast: (message: string, variant?: ToastVariant) => number;
  dismissToast: (id: number) => void;
}

// Not state: an incrementing counter only needs to be unique, and Date.now()
// collides when two toasts are pushed in the same millisecond.
let nextId = 0;

// key: toast id — timers live outside the store because they must not
// re-render anything, and an early dismiss has to be able to cancel one.
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  showToast: (message, variant = 'success') => {
    const id = ++nextId;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    timers.set(id, setTimeout(() => get().dismissToast(id), TOAST_TTL_MS));
    return id;
  },

  dismissToast: (id) => {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
