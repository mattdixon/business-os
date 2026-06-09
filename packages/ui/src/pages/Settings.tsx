import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { Api, ApiError, type TotpEnrollResponse, type Theme } from '../lib/api';

export function Settings(): JSX.Element {
  const { state, refresh } = useAuth();
  const email = state.kind === 'authenticated' ? state.user.email : '—';
  const enrolled = state.kind === 'authenticated' && state.totpEnrolled;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Account-level settings for the operator console."
      />
      <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
        <section className="card p-6">
          <h2 className="section-heading mb-3">Account</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-500 dark:text-ink-400">Email</dt>
            <dd className="font-mono text-ink-800 dark:text-ink-200">{email}</dd>
          </dl>
        </section>

        <section className="card p-6">
          <h2 className="section-heading mb-1">Appearance</h2>
          <p className="mb-4 text-sm text-ink-600 dark:text-ink-400">
            Pick a theme. <em>System</em> follows your OS setting and updates automatically
            when you toggle dark mode at the OS level.
          </p>
          <ThemePicker />
        </section>

        <section className="card p-6">
          <h2 className="section-heading mb-3">Two-factor authentication</h2>
          {enrolled ? (
            <DisableTotp onChange={refresh} />
          ) : (
            <EnrollTotp onChange={refresh} />
          )}
        </section>
      </div>
    </div>
  );
}

const THEME_OPTIONS: Array<{ value: Theme; label: string; hint: string; preview: JSX.Element }> = [
  {
    value: 'light',
    label: 'Light',
    hint: 'Always light, regardless of OS',
    preview: (
      <div className="h-12 w-full rounded border border-ink-200 bg-white">
        <div className="h-3 w-full rounded-t border-b border-ink-100 bg-ink-50" />
        <div className="mx-2 mt-1 h-1.5 w-2/3 rounded bg-ink-200" />
        <div className="mx-2 mt-1 h-1.5 w-1/2 rounded bg-ink-100" />
      </div>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    hint: 'Always dark, regardless of OS',
    preview: (
      <div className="h-12 w-full rounded border border-ink-700 bg-ink-900">
        <div className="h-3 w-full rounded-t border-b border-ink-800 bg-ink-800" />
        <div className="mx-2 mt-1 h-1.5 w-2/3 rounded bg-ink-700" />
        <div className="mx-2 mt-1 h-1.5 w-1/2 rounded bg-ink-800" />
      </div>
    ),
  },
  {
    value: 'system',
    label: 'System',
    hint: 'Match the OS preference',
    preview: (
      <div className="flex h-12 w-full overflow-hidden rounded border border-ink-300">
        <div className="w-1/2 bg-white">
          <div className="mx-1.5 mt-2 h-1.5 w-2/3 rounded bg-ink-200" />
          <div className="mx-1.5 mt-1 h-1.5 w-1/2 rounded bg-ink-100" />
        </div>
        <div className="w-1/2 bg-ink-900">
          <div className="mx-1.5 mt-2 h-1.5 w-2/3 rounded bg-ink-700" />
          <div className="mx-1.5 mt-1 h-1.5 w-1/2 rounded bg-ink-800" />
        </div>
      </div>
    ),
  },
];

function ThemePicker(): JSX.Element {
  const { preference, setPreference } = useTheme();
  const [busy, setBusy] = useState<Theme | null>(null);

  const choose = async (value: Theme) => {
    if (value === preference) return;
    setBusy(value);
    try {
      await setPreference(value);
    } finally {
      setBusy(null);
    }
  };

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEME_OPTIONS.map((opt) => {
          const selected = preference === opt.value;
          return (
            <label
              key={opt.value}
              className={`group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors ${
                selected
                  ? 'border-accent bg-accent/5 ring-1 ring-accent dark:bg-accent/10'
                  : 'border-ink-200 hover:border-ink-300 dark:border-ink-700 dark:hover:border-ink-600'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={opt.value}
                checked={selected}
                onChange={() => void choose(opt.value)}
                className="sr-only"
              />
              {opt.preview}
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-ink-900 dark:text-ink-100">
                  {opt.label}
                </span>
                {selected && <span className="pill-ok">on</span>}
                {busy === opt.value && !selected && (
                  <span className="text-xs text-ink-500">saving…</span>
                )}
              </div>
              <span className="text-xs text-ink-500 dark:text-ink-400">{opt.hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function EnrollTotp(props: { onChange: () => Promise<void> }): JSX.Element {
  const [stage, setStage] = useState<'idle' | 'enrolling' | 'confirming'>('idle');
  const [enrollment, setEnrollment] = useState<TotpEnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = async (): Promise<void> => {
    setError(null);
    setStage('enrolling');
    try {
      const r = await Api.enrollTotp();
      setEnrollment(r);
      setStage('confirming');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'enrollment failed');
      setStage('idle');
    }
  };

  const confirm = async (): Promise<void> => {
    setError(null);
    try {
      await Api.confirmTotp(code);
      await props.onChange();
      setEnrollment(null);
      setCode('');
      setStage('idle');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'confirmation failed');
    }
  };

  if (stage === 'idle') {
    return (
      <div>
        <p className="mb-3 text-sm text-ink-600">
          TOTP is not enabled on your account. Enrolling adds a required second factor at
          login.
        </p>
        <button className="btn-primary" onClick={start}>
          Enroll two-factor
        </button>
        {error && <div className="mt-2 text-xs text-bad">{error}</div>}
      </div>
    );
  }

  if (stage === 'enrolling' || !enrollment) {
    return <div className="text-sm text-ink-500">Generating secret…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-ink-600">
          Paste the secret into your authenticator app (1Password, Authy, Google
          Authenticator, etc.), or copy the otpauth URI directly.
        </p>
      </div>
      <div className="rounded border border-ink-200 bg-ink-50 p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
          otpauth URI
        </div>
        <div className="break-all font-mono text-xs text-ink-700">{enrollment.otpauthUri}</div>
      </div>
      <div className="rounded border border-ink-200 bg-ink-50 p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
          Or enter manually
        </div>
        <div className="font-mono text-sm text-ink-700">{enrollment.secret}</div>
      </div>

      <div>
        <label className="label">Enter the current code from your app</label>
        <input
          className="input-mono w-32 tracking-widest"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoComplete="one-time-code"
        />
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={code.length !== 6} onClick={confirm}>
          Confirm
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setEnrollment(null);
            setStage('idle');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DisableTotp(props: { onChange: () => Promise<void> }): JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const disable = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      await Api.disableTotp(code);
      await props.onChange();
      setCode('');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'disable failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="pill-ok">enabled</span>
        <span className="text-ink-600">
          Login requires a second factor in addition to your password.
        </span>
      </div>
      <div>
        <label className="label">Enter your current code to disable</label>
        <input
          className="input-mono w-32 tracking-widest"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoComplete="one-time-code"
        />
      </div>
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      <button
        className="btn-danger"
        disabled={code.length !== 6 || submitting}
        onClick={disable}
      >
        {submitting ? 'Disabling…' : 'Disable two-factor'}
      </button>
    </div>
  );
}
