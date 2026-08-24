import { CheckCircleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { useToastStore } from '../../stores/toastStore';

/**
 * Renders every active toast. Mounted once in `App`, above the router, so a
 * toast outlives the component that triggered it — which is the whole point:
 * saving your profile closes the modal, and the confirmation has to survive
 * that unmount.
 */
export default function Toaster() {
  const { toasts, dismissToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const isError = toast.variant === 'error';
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur-sm animate-fade-in ${
              isError
                ? 'bg-red-500/15 border-red-400/40 text-red-500'
                : 'bg-green-500/15 border-green-400/40 text-green-600'
            }`}
          >
            {isError ? (
              <WarningCircleIcon size={16} weight="fill" className="flex-shrink-0" />
            ) : (
              <CheckCircleIcon size={16} weight="fill" className="flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{toast.message}</p>
            <button
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="ml-1 opacity-50 hover:opacity-100 transition"
            >
              <XIcon size={12} weight="bold" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
