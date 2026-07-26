import type { ReactNode } from 'react';
import { CircleNotchIcon } from '@phosphor-icons/react';

interface ButtonProps {
  children: ReactNode;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  size?: 'md' | 'sm';
}

export default function Button({
  children,
  type = 'submit',
  onClick,
  disabled,
  loading,
  loadingLabel,
  fullWidth,
  size = 'md',
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${fullWidth ? 'w-full' : ''} ${size === 'md' ? 'py-3 px-4' : 'py-2 px-4'} rounded-xl font-semibold text-sm text-[#1a1a2e] bg-primary hover:bg-[#8fd6fc] outline-none transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-2`}
    >
      {loading ? (
        <>
          <CircleNotchIcon size={16} className="animate-spin" />
          {loadingLabel ?? 'Loading...'}
        </>
      ) : (
        children
      )}
    </button>
  );
}
