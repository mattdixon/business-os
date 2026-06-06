import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../lib/auth';
import { Api, ApiError, type TotpEnrollResponse } from '../lib/api';

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
      <div className="space-y-6 p-8">
        <section className="card p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Account
          </h2>
          <div className="text-sm text-ink-700">
            <div>
              <span className="text-ink-500">Email:</span>{' '}
              <span className="font-mono">{email}</span>
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Two-factor authentication
          </h2>
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
