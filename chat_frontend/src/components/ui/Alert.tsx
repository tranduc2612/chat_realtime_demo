import { WarningCircleIcon, CheckCircleIcon } from '@phosphor-icons/react';

interface AlertProps {
  message: string;
  variant?: 'error' | 'success';
}

export default function Alert({ message, variant = 'error' }: AlertProps) {
  const isSuccess = variant === 'success';

  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 animate-fade-in border ${
        isSuccess ? 'bg-green-500/10 border-green-400/30' : 'bg-red-500/10 border-red-400/30'
      }`}
    >
      {isSuccess ? (
        <CheckCircleIcon size={16} weight="fill" className="text-green-500 flex-shrink-0" />
      ) : (
        <WarningCircleIcon size={16} weight="fill" className="text-red-400 flex-shrink-0" />
      )}
      <p className={`text-sm ${isSuccess ? 'text-green-500' : 'text-red-500'}`}>{message}</p>
    </div>
  );
}
