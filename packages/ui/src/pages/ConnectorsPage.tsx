import { useEffect, useState } from 'react';
import { Api, ApiError, type ConnectorCapability } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { SchemaForm, type FieldSchema } from '../components/SchemaForm';
import { useToast } from '../lib/toast';

function apiErrorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  const body = e.body as { issues?: Array<{ path?: string[]; message?: string }> } | null;
  if (body?.issues?.length) {
    return body.issues
      .map((i) => `${i.path?.join('.') ?? 'value'}: ${i.message ?? 'invalid'}`)
      .join('; ');
  }
  return e.message || fallback;
}

export function ConnectorsPage(): JSX.Element {
  const { toast } = useToast();
  const [caps, setCaps] = useState<ConnectorCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null); // capability being added to

  const reload = async (): Promise<void> => {
    try {
      const r = await Api.listConnectors();
      setCaps(r.capabilities);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load failed');
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const addInstance = async (
    capability: string,
    providerSlug: string,
    displayName: string,
  ): Promise<void> => {
    try {
      await Api.createConnector({ capability, providerSlug, displayName });
      toast.success('Connector instance added.');
      setAdding(null);
      await reload();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Add failed.'));
    }
  };

  const activate = async (id: string): Promise<void> => {
    try {
      await Api.updateConnector(id, { isActive: true });
      toast.success('Activated.');
      await reload();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Activate failed.'));
    }
  };
  const deactivate = async (id: string): Promise<void> => {
    try {
      await Api.updateConnector(id, { isActive: false });
      toast.success('Deactivated.');
      await reload();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Deactivate failed.'));
    }
  };
  const setCreds = async (id: string, creds: unknown): Promise<void> => {
    try {
      await Api.setConnectorCredentials(id, creds);
      toast.success('Credentials saved (encrypted).');
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Save failed.'));
      throw e;
    }
  };
  const remove = async (id: string): Promise<void> => {
    if (!confirm('Delete this connector instance? Credentials will be wiped.')) return;
    try {
      await Api.deleteConnector(id);
      toast.success('Deleted.');
      await reload();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Delete failed.'));
    }
  };

  const updateInstanceSettings = async (id: string, settings: unknown): Promise<void> => {
    try {
      await Api.updateConnector(id, { settings });
      toast.success('Settings saved.');
      await reload();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Save failed.'));
      throw e;
    }
  };

  return (
    <div>
      <PageHeader
        title="Connectors"
        description="What this install can talk to. Operator picks the active provider per capability."
      />
      <div className="space-y-6 px-8 py-6">
        {error && (
          <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        )}
        {!caps && <div className="text-ink-500">Loading…</div>}
        {caps?.map((cap) => (
          <section key={cap.capability} className="card p-5">
            <header className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-500">capability</div>
                <h2 className="font-mono text-lg font-semibold">{cap.capability}</h2>
              </div>
              {cap.providers.length > 0 && (
                <button
                  className="btn-secondary"
                  onClick={() =>
                    setAdding(adding === cap.capability ? null : cap.capability)
                  }
                >
                  {adding === cap.capability ? 'Cancel' : 'Add instance'}
                </button>
              )}
            </header>

            {cap.providers.length === 0 && (
              <div className="text-sm text-ink-500">
                No providers registered for this capability.
              </div>
            )}

            {adding === cap.capability && (
              <AddForm
                capability={cap.capability}
                providers={cap.providers}
                onAdd={addInstance}
              />
            )}

            {cap.instances.length > 0 && (
              <div className="mt-4 space-y-3">
                {cap.instances.map((inst) => {
                  const provider = cap.providers.find((p) => p.slug === inst.providerSlug);
                  return (
                    <InstanceCard
                      key={inst.id}
                      capability={cap.capability}
                      instance={inst}
                      authKind={provider?.authKind ?? 'none'}
                      externalOAuth={provider?.externalOAuth}
                      settingsSchema={provider?.settingsSchema as FieldSchema | undefined}
                      onActivate={() => activate(inst.id)}
                      onDeactivate={() => deactivate(inst.id)}
                      onSetCreds={(c) => setCreds(inst.id, c)}
                      onUpdateSettings={(s) => updateInstanceSettings(inst.id, s)}
                      onRemove={() => remove(inst.id)}
                      onAfterConnect={reload}
                    />
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function AddForm(props: {
  capability: string;
  providers: ConnectorCapability['providers'];
  onAdd: (capability: string, providerSlug: string, displayName: string) => Promise<void>;
}): JSX.Element {
  const [providerSlug, setProviderSlug] = useState(props.providers[0]?.slug ?? '');
  const [displayName, setDisplayName] = useState(
    props.providers[0]?.displayName ?? '',
  );
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 rounded border border-ink-200 bg-ink-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Provider</label>
          <select
            className="input"
            value={providerSlug}
            onChange={(e) => {
              setProviderSlug(e.target.value);
              const p = props.providers.find((x) => x.slug === e.target.value);
              if (p) setDisplayName(p.displayName);
            }}
          >
            {props.providers.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.displayName} ({p.authKind})
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Display name</label>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3">
        <button
          className="btn-primary"
          disabled={busy || !providerSlug || !displayName}
          onClick={async () => {
            setBusy(true);
            await props.onAdd(props.capability, providerSlug, displayName);
            setBusy(false);
          }}
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

function InstanceCard(props: {
  capability: string;
  instance: ConnectorCapability['instances'][number];
  authKind: 'oauth2' | 'api-key' | 'none';
  externalOAuth?: { provider: 'composio'; toolkit: string };
  settingsSchema?: FieldSchema;
  onActivate: () => Promise<void>;
  onDeactivate: () => Promise<void>;
  onSetCreds: (creds: unknown) => Promise<void>;
  onUpdateSettings: (settings: unknown) => Promise<void>;
  onRemove: () => Promise<void>;
  /** Called after a successful external-OAuth connection so parent reloads. */
  onAfterConnect: () => Promise<void>;
}): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<unknown>(props.instance.settings ?? {});
  const [settingsSaveState, setSettingsSaveState] = useState<'idle' | 'saving' | 'ok' | 'error'>(
    'idle',
  );
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const hasSettingsSchema =
    props.settingsSchema &&
    props.settingsSchema.type === 'object' &&
    Object.keys((props.settingsSchema as { fields: object }).fields).length > 0;

  return (
    <div className="rounded border border-ink-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{props.instance.displayName}</span>
            {props.instance.isActive ? (
              <span className="pill-ok">connected</span>
            ) : (
              <span className="pill-muted">not connected</span>
            )}
          </div>
          <div className="font-mono text-xs text-ink-500">
            {props.instance.providerSlug} · {props.authKind} · added{' '}
            {new Date(props.instance.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {props.externalOAuth && (
            <ConnectButton
              instanceId={props.instance.id}
              toolkit={props.externalOAuth.toolkit}
              broker={props.externalOAuth.provider}
              onConnected={props.onAfterConnect}
            />
          )}
          {!props.externalOAuth && props.authKind === 'api-key' && (
            <div>
              <label className="label">API key</label>
              <div className="flex items-center gap-2">
                <input
                  className="input-mono w-72"
                  type="password"
                  placeholder="paste here"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setCredsSaved(false);
                    setCredsError(null);
                  }}
                />
                <button
                  className="btn-secondary"
                  disabled={!apiKey}
                  onClick={async () => {
                    try {
                      await props.onSetCreds({ key: apiKey });
                      setApiKey('');
                      setCredsSaved(true);
                    } catch (e: unknown) {
                      setCredsError(e instanceof Error ? e.message : 'save failed');
                    }
                  }}
                >
                  Save
                </button>
              </div>
              {credsSaved && <div className="mt-1 text-xs text-ok">Saved (encrypted).</div>}
              {credsError && <div className="mt-1 text-xs text-bad">{credsError}</div>}
            </div>
          )}
          {hasSettingsSchema && (
            <button
              className="btn-secondary"
              onClick={() => setShowSettings(!showSettings)}
            >
              {showSettings ? 'Hide settings' : 'Settings'}
            </button>
          )}
          {props.instance.isActive ? (
            <button className="btn-secondary" onClick={props.onDeactivate}>
              Disconnect
            </button>
          ) : !props.externalOAuth ? (
            // For manual-credentials connectors, activation is a deliberate
            // toggle. Composio-backed connectors flip active automatically on
            // successful Connect, so no manual button needed.
            <button className="btn-primary" onClick={props.onActivate}>
              Mark connected
            </button>
          ) : null}
          <button className="btn-danger" onClick={props.onRemove}>
            Delete
          </button>
        </div>
      </div>
      {/* settings section */}
      {showSettings && hasSettingsSchema && props.settingsSchema && (
        <div className="mt-4 border-t border-ink-200 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">
            Provider settings
          </h3>
          <SchemaForm
            schema={props.settingsSchema}
            value={draftSettings}
            onChange={setDraftSettings}
          />
          {settingsError && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {settingsError}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              className="btn-primary"
              disabled={settingsSaveState === 'saving'}
              onClick={async () => {
                setSettingsSaveState('saving');
                setSettingsError(null);
                try {
                  await props.onUpdateSettings(draftSettings);
                  setSettingsSaveState('ok');
                  setTimeout(() => setSettingsSaveState('idle'), 1500);
                } catch (e: unknown) {
                  setSettingsSaveState('error');
                  setSettingsError(e instanceof Error ? e.message : 'save failed');
                }
              }}
            >
              {settingsSaveState === 'saving' ? 'Saving…' : 'Save settings'}
            </button>
            {settingsSaveState === 'ok' && <span className="text-xs text-ok">Saved.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * External-OAuth "Connect" button. Opens the broker's consent URL in a popup
 * and polls the server every 2s until the broker reports an ACTIVE connection
 * (or the operator gives up). Reloads the parent on success so the new
 * connection state + active badge surface immediately.
 */
function ConnectButton(props: {
  instanceId: string;
  toolkit: string;
  broker: 'composio';
  onConnected: () => Promise<void>;
}): JSX.Element {
  const { toast } = useToast();
  const [busy, setBusy] = useState<'idle' | 'awaiting' | 'finalizing'>('idle');

  const start = async (): Promise<void> => {
    setBusy('awaiting');
    let popup: Window | null = null;
    try {
      const { redirectUrl } = await Api.connectConnector(props.instanceId);
      popup = window.open(redirectUrl, `${props.broker}-connect-${props.instanceId}`, 'width=600,height=720');
      if (!popup) {
        toast.error('Pop-up blocked. Allow pop-ups and try again.');
        setBusy('idle');
        return;
      }

      // Poll for completion. Stop on success, on the popup closing without a
      // connection (operator cancelled), or after 5 minutes.
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const out = await Api.finalizeConnectConnector(props.instanceId);
        if ('ok' in out && out.ok) {
          setBusy('idle');
          try { popup.close(); } catch { /* ignore */ }
          toast.success(`${props.toolkit} connected.`);
          await props.onConnected();
          return;
        }
        if (popup.closed) {
          setBusy('idle');
          toast.error('Connect window closed before authorization completed.');
          return;
        }
      }
      setBusy('idle');
      toast.error('Connect timed out. Try again.');
      try { popup.close(); } catch { /* ignore */ }
    } catch (e: unknown) {
      setBusy('idle');
      toast.error(apiErrorMessage(e, 'Connect failed.'));
      try { popup?.close(); } catch { /* ignore */ }
    }
  };

  return (
    <button className="btn-primary" disabled={busy !== 'idle'} onClick={start}>
      {busy === 'awaiting' ? 'Waiting for consent…' : `Connect ${props.toolkit}`}
    </button>
  );
}
