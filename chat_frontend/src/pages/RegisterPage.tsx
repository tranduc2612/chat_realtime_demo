import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserIcon, EnvelopeSimpleIcon, LockKeyIcon } from '@phosphor-icons/react';
import { useAuthStore } from '../stores/authStore';
import { useThemeStore } from '../stores/themeStore';
import AuthLayout from '../components/auth/AuthLayout';
import AuthField from '../components/auth/AuthField';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';

interface FormValues {
  fullName: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
}

type FieldName = keyof FormValues;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]+$/;

function validateField(name: FieldName, values: FormValues): string {
  switch (name) {
    case 'fullName': {
      if (values.fullName.trim().length > 100) return 'Full name must be at most 100 characters';
      return '';
    }
    case 'email': {
      const v = values.email.trim();
      if (!v) return 'Email is required';
      if (!EMAIL_RE.test(v)) return 'Enter a valid email address';
      return '';
    }
    case 'username': {
      const v = values.username.trim();
      if (!v) return 'Username is required';
      if (v.length < 3) return 'Username must be at least 3 characters';
      if (v.length > 100) return 'Username must be at most 100 characters';
      if (!USERNAME_RE.test(v)) return 'Only letters, numbers, "_" and "." are allowed';
      return '';
    }
    case 'password': {
      if (!values.password) return 'Password is required';
      if (values.password.length < 8) return 'Password must be at least 8 characters';
      return '';
    }
    case 'confirmPassword': {
      if (!values.confirmPassword) return 'Please confirm your password';
      if (values.confirmPassword !== values.password) return 'Passwords do not match';
      return '';
    }
    default:
      return '';
  }
}

function validateAll(values: FormValues): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  (['fullName', 'email', 'username', 'password', 'confirmPassword'] as FieldName[]).forEach((name) => {
    const message = validateField(name, values);
    if (message) errors[name] = message;
  });
  return errors;
}

export default function RegisterPage() {
  const [values, setValues] = useState<FormValues>({
    fullName: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuthStore();
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  const handleChange = (name: FieldName) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValues = { ...values, [name]: e.target.value };
    setValues(nextValues);
    if (touched[name] || errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: validateField(name, nextValues) }));
      // Re-check confirmPassword whenever password changes and it was already touched.
      if (name === 'password' && (touched.confirmPassword || errors.confirmPassword)) {
        setErrors((prev) => ({ ...prev, confirmPassword: validateField('confirmPassword', nextValues) }));
      }
    }
  };

  const handleBlur = (name: FieldName) => () => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validateField(name, values) }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    const allErrors = validateAll(values);
    setErrors(allErrors);
    setTouched({ fullName: true, email: true, username: true, password: true, confirmPassword: true });

    if (Object.keys(allErrors).length > 0) return;

    setLoading(true);
    try {
      await register({
        email: values.email.trim(),
        username: values.username.trim(),
        password: values.password,
        full_name: values.fullName.trim() || undefined,
      });
      navigate('/');
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '';
      const lower = detail.toLowerCase();
      if (lower.includes('email')) {
        setErrors((prev) => ({ ...prev, email: detail }));
      } else if (lower.includes('username')) {
        setErrors((prev) => ({ ...prev, username: detail }));
      } else {
        setFormError(detail || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join and start chatting in seconds"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className={`font-semibold ${isDark ? 'text-[#AEE2FF]' : 'text-[#1f6a94]'}`}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <AuthField
          id="fullName"
          label="Full name"
          optional
          value={values.fullName}
          onChange={handleChange('fullName')}
          onBlur={handleBlur('fullName')}
          autoComplete="name"
          placeholder="Jane Kowalski"
          error={errors.fullName}
        />

        <AuthField
          id="email"
          label="Email"
          type="email"
          icon={EnvelopeSimpleIcon}
          value={values.email}
          onChange={handleChange('email')}
          onBlur={handleBlur('email')}
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email}
        />

        <AuthField
          id="username"
          label="Username"
          icon={UserIcon}
          value={values.username}
          onChange={handleChange('username')}
          onBlur={handleBlur('username')}
          autoComplete="username"
          placeholder="your_username"
          error={errors.username}
        />

        <AuthField
          id="password"
          label="Password"
          icon={LockKeyIcon}
          isPassword
          value={values.password}
          onChange={handleChange('password')}
          onBlur={handleBlur('password')}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          error={errors.password}
        />

        <AuthField
          id="confirmPassword"
          label="Confirm password"
          icon={LockKeyIcon}
          isPassword
          value={values.confirmPassword}
          onChange={handleChange('confirmPassword')}
          onBlur={handleBlur('confirmPassword')}
          autoComplete="new-password"
          placeholder="Re-enter your password"
          error={errors.confirmPassword}
        />

        {formError && <Alert message={formError} />}

        <Button fullWidth loading={loading} loadingLabel="Creating account...">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
