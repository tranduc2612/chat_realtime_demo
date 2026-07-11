import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import ThemeToggle from '../components/ui/ThemeToggle';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const { theme } = useThemeStore();
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch {
      setError('Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen relative flex items-center justify-center overflow-hidden transition-colors duration-500 ${isDark ? 'dark-autofill' : ''}`}>
      {/* Background */}
      {isDark ? (
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f0c29] via-[#302b63] to-[#24243e]" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#dbeafe] via-[#ede9fe] to-[#fce7f3]" />
      )}

      {/* Floating blobs */}
      {isDark ? (
        <>
          <div className="absolute top-[-80px] left-[-60px] w-72 h-72 rounded-full bg-purple-600/30 blur-3xl animate-blob" />
          <div className="absolute top-1/3 right-[-80px] w-80 h-80 rounded-full bg-blue-500/20 blur-3xl animate-blob2" />
          <div className="absolute bottom-[-60px] left-1/3 w-64 h-64 rounded-full bg-indigo-500/25 blur-3xl animate-blob3" />
          <div className="absolute top-1/2 left-1/4 w-48 h-48 rounded-full bg-sky-400/15 blur-2xl animate-blob" style={{ animationDelay: '3s' }} />
        </>
      ) : (
        <>
          <div className="absolute top-[-80px] left-[-60px] w-72 h-72 rounded-full bg-blue-300/40 blur-3xl animate-blob" />
          <div className="absolute top-1/3 right-[-80px] w-80 h-80 rounded-full bg-purple-300/30 blur-3xl animate-blob2" />
          <div className="absolute bottom-[-60px] left-1/3 w-64 h-64 rounded-full bg-pink-300/30 blur-3xl animate-blob3" />
          <div className="absolute top-1/2 left-1/4 w-48 h-48 rounded-full bg-sky-300/25 blur-2xl animate-blob" style={{ animationDelay: '3s' }} />
        </>
      )}

      {/* Theme toggle — top right */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div className={`rounded-3xl p-8 shadow-2xl transition-all duration-300 ${isDark ? 'glass-dark' : 'glass-light'}`}>
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/30">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="white" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
              </svg>
            </div>
            <h1 className={`text-2xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-800'}`}>
              Welcome back
            </h1>
            <p className={`text-sm mt-1 ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
              Sign in to continue chatting
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div className="space-y-1.5">
              <label className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                Username
              </label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="your_username"
                  className={`w-full pl-9 pr-4 py-3 rounded-xl text-sm outline-none transition-all duration-200 ${
                    isDark
                      ? 'bg-white/10 border border-white/15 text-white placeholder-white/30 focus:border-sky-400/70 focus:bg-white/15 focus:ring-1 focus:ring-sky-400/40'
                      : 'bg-white/70 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20'
                  }`}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                Password
              </label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`w-full pl-9 pr-10 py-3 rounded-xl text-sm outline-none transition-all duration-200 ${
                    isDark
                      ? 'bg-white/10 border border-white/15 text-white placeholder-white/30 focus:border-sky-400/70 focus:bg-white/15 focus:ring-1 focus:ring-sky-400/40'
                      : 'bg-white/70 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 transition ${isDark ? 'text-white/40 hover:text-white/70' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 animate-fade-in ${
                isDark ? 'bg-red-500/15 border border-red-400/30' : 'bg-red-50 border border-red-200'
              }`}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-red-400 flex-shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 mt-2 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Signing in…
                </>
              ) : 'Sign in'}
            </button>
          </form>
        </div>

        <p className={`text-center text-xs mt-5 ${isDark ? 'text-white/20' : 'text-slate-400/70'}`}>
          Real-time Chat · Secure & Private
        </p>
      </div>
    </div>
  );
}
