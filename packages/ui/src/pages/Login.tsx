import { useState, type FormEvent } from 'react';
import { Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export function Login(): JSX.Element {
  const { state, login } = useAuth();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (state.kind === 'authenticated') {
    return <Navigate to={loc.state?.from ?? '/agents'} replace />;
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, totp || undefined);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.message === 'totp_required') {
          setNeedsTotp(true);
          setError('Two-factor code required.');
        } else if (err.message === 'invalid_credentials') {
          setError('Email or password is incorrect.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Network error — try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <form
        onSubmit={onSubmit}
        className="card w-full max-w-sm space-y-5 p-8"
      >
        <header>
          <h1 className="text-base font-semibold">Business OS</h1>
          <p className="mt-1 text-sm text-ink-500">Sign in to the operator console.</p>
        </header>

        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="input"
            required
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="input"
            required
          />
        </div>

        {needsTotp && (
          <div>
            <label htmlFor="totp" className="label">
              Authenticator code
            </label>
            <input
              id="totp"
              inputMode="numeric"
              pattern="\d{6}"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              className="input-mono tracking-widest"
              maxLength={6}
              autoComplete="one-time-code"
            />
          </div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="text-center text-xs text-ink-500">
          <Link to="/reset/request" className="text-accent hover:underline">
            Forgot your password?
          </Link>
        </div>
      </form>
    </div>
  );
}
