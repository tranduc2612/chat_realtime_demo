import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserIcon, LockKeyIcon } from '@phosphor-icons/react';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import AuthLayout from '../components/auth/AuthLayout';
import AuthField from '../components/auth/AuthField';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

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
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue chatting"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/register" className={`font-semibold ${isDark ? 'text-[#AEE2FF]' : 'text-[#1f6a94]'}`}>
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          id="username"
          label="Username"
          icon={UserIcon}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          placeholder="your_username"
        />

        <AuthField
          id="password"
          label="Password"
          icon={LockKeyIcon}
          isPassword
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="Enter your password"
        />

        {error && <Alert message={error} />}

        <Button fullWidth loading={loading} loadingLabel="Signing in...">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
