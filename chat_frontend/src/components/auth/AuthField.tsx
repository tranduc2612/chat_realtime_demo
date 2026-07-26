import { useState } from 'react';
import type { ChangeEventHandler, FocusEventHandler } from 'react';
import { EyeIcon, EyeSlashIcon, type Icon } from '@phosphor-icons/react';
import { useThemeStore } from '../../stores/themeStore';

interface AuthFieldProps {
  id: string;
  label: string;
  type?: string;
  icon?: Icon;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  optional?: boolean;
  isPassword?: boolean;
}

export default function AuthField({
  id,
  label,
  type = 'text',
  icon: FieldIcon,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  autoComplete,
  required,
  optional,
  isPassword,
}: AuthFieldProps) {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const [show, setShow] = useState(false);
  const hasError = !!error;
  const inputType = isPassword ? (show ? 'text' : 'password') : type;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-white/60' : 'text-slate-500'}`}
      >
        {label}
        {optional && <span className="normal-case font-normal opacity-60"> (optional)</span>}
      </label>
      <div className="relative">
        {FieldIcon && (
          <span
            className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? 'text-white/40' : 'text-slate-400'}`}
          >
            <FieldIcon size={16} />
          </span>
        )}
        <input
          id={id}
          name={id}
          type={inputType}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={hasError}
          className={`w-full py-3 ${FieldIcon ? 'pl-9' : 'pl-4'} ${isPassword ? 'pr-10' : 'pr-4'} rounded-xl text-sm outline-none transition-all duration-200 ${
            isDark
              ? `bg-white/[0.06] border text-white placeholder-white/30 focus:bg-white/[0.09] ${
                  hasError
                    ? 'border-red-400/60 focus:border-red-400 focus:ring-1 focus:ring-red-400/30'
                    : 'border-white/10 focus:border-[#AEE2FF]/70 focus:ring-1 focus:ring-[#AEE2FF]/30'
                }`
              : `bg-white border text-slate-800 placeholder-slate-400 focus:bg-white ${
                  hasError
                    ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-400/15'
                    : 'border-slate-200 focus:border-[#6ec3f5] focus:ring-2 focus:ring-[#AEE2FF]/40'
                }`
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            tabIndex={-1}
            aria-label={show ? 'Hide password' : 'Show password'}
            className={`absolute right-3 top-1/2 -translate-y-1/2 transition ${isDark ? 'text-white/40 hover:text-white/70' : 'text-slate-400 hover:text-slate-600'}`}
          >
            {show ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
