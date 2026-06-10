import { useEffect, useState } from 'react';
import { Api, ApiError } from '../lib/api';
import { capabilityLabel } from '../lib/capability-labels';
import { useToast } from '../lib/toast';

/**
 * "Available" tab on the Connectors page. The marketplace of framework
 * connector providers the install knows about. Toggling on makes a
 * provider visible in the Add-instance dropdown on the Configured tab.
 * Toggling off hides it from the dropdown but leaves any configured
 * instances alone.
 *
 * Lives as its own component so the merged Connectors page stays readable
 * and the providers code can be unit-tested in isolation later if needed.
 */

interface ProvidersResponse {
  capabilities: Array<{
    capability: string;
    providers: Array<{
      slug: string;
      displayName: string;
      authKind: 'oauth2' | 'api-key' | 'none' | 'custom';
      externalOAuth?: { provider: 'composio'; toolkit: string };
      version: string;
      enabled: boolean;
    }>;
  }>;
}

export function ProvidersTab(): JSX.Element {
  const { toast } = useToast();
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const r = await Api.listProviders();
      setData(r);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load failed');
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const toggle = async (capability: string, slug: string, next: boolean): Promise<void> => {
    const key = `${capability}:${slug}`;
    setBusy(key);
    // Optimistic update so the switch feels instant. Revert on failure.
    setData((prev) => {
      if (!prev) return prev;
      return {
        capabilities: prev.capabilities.map((cap) =>
          cap.capability !== capability
            ? cap
            : {
                ...cap,
                providers: cap.providers.map((p) =>
                  p.slug === slug ? { ...p, enabled: next } : p,
                ),
              },
        ),
      };
    });
    try {
      await Api.setProviderEnabled(capability, slug, next);
      toast.success(`${slug}: ${next ? 'enabled' : 'disabled'}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'toggle failed');
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-500 dark:text-ink-400">
        Every framework connector this install knows about. Disable a provider
        to hide it from the Add-instance dropdown — existing instances keep
        working until you delete them.
      </p>
      {error && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </div>
      )}
      {!data && <div className="text-sm text-ink-500 dark:text-ink-400">Loading…</div>}
      {data?.capabilities.map((cap) => (
        <section key={cap.capability} className="card p-6">
          <div className="mb-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500 dark:text-ink-400">
              Capability
            </div>
            <h2 className="mt-0.5 text-lg font-semibold tracking-tight">
              {capabilityLabel(cap.capability)}
              <span className="ml-2 font-mono text-xs font-normal text-ink-500 dark:text-ink-400">
                {cap.capability}
              </span>
            </h2>
          </div>
          {cap.providers.length === 0 ? (
            <div className="text-sm text-ink-500 dark:text-ink-400">
              No framework providers registered for this capability.
            </div>
          ) : (
            <ul className="divide-y divide-ink-100 dark:divide-ink-800">
              {cap.providers.map((p) => {
                const key = `${cap.capability}:${p.slug}`;
                const isBusy = busy === key;
                return (
                  <li
                    key={p.slug}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink-900 dark:text-ink-100">
                        {p.displayName}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-ink-500 dark:text-ink-400">
                        {p.slug} · {p.authKind}
                        {p.externalOAuth ? ` · ${p.externalOAuth.provider}` : ''} · v
                        {p.version}
                      </div>
                    </div>
                    <Toggle
                      checked={p.enabled}
                      disabled={isBusy}
                      onChange={(next) => void toggle(cap.capability, p.slug, next)}
                      label={`${p.enabled ? 'Disable' : 'Enable'} ${p.displayName}`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Toggle(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <label
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        props.checked ? 'bg-accent' : 'bg-ink-200 dark:bg-ink-700'
      } ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      aria-label={props.label}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          props.checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </label>
  );
}
