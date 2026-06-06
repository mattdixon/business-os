import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../lib/auth';

export function Settings(): JSX.Element {
  const { state } = useAuth();
  const email = state.kind === 'authenticated' ? state.user.email : '—';
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
              <span className="text-ink-500">Email:</span> <span className="font-mono">{email}</span>
            </div>
          </div>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Two-factor
          </h2>
          <p className="text-sm text-ink-500">
            TOTP enrollment available via the API
            (<code className="font-mono">POST /auth/totp/enroll</code> →{' '}
            <code className="font-mono">POST /auth/totp/confirm</code>) — a UI flow lands
            in a later slice.
          </p>
        </section>
      </div>
    </div>
  );
}
