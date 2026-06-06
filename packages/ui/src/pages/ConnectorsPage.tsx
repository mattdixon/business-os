import { useEffect, useState } from 'react';
import { Api, ApiError, type ConnectorCapability } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

export function ConnectorsPage(): JSX.Element {
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
    await Api.createConnector({ capability, providerSlug, displayName });
    setAdding(null);
    await reload();
  };

  const activate = async (id: string): Promise<void> => {
    await Api.updateConnector(id, { isActive: true });
    await reload();
  };
  const deactivate = async (id: string): Promise<void> => {
    await Api.updateConnector(id, { isActive: false });
    await reload();
  };
  const setCreds = async (id: string, creds: unknown): Promise<void> => {
    await Api.setConnectorCredentials(id, creds);
  };
  const remove = async (id: string): Promise<void> => {
    if (!confirm('Delete this connector instance? Credentials will be wiped.')) return;
    await Api.deleteConnector(id);
    await reload();
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
                {cap.instances.map((inst) => (
                  <InstanceCard
                    key={inst.id}
                    capability={cap.capability}
                    instance={inst}
                    authKind={
                      cap.providers.find((p) => p.slug === inst.providerSlug)?.authKind ?? 'none'
                    }
                    onActivate={() => activate(inst.id)}
                    onDeactivate={() => deactivate(inst.id)}
                    onSetCreds={(c) => setCreds(inst.id, c)}
                    onRemove={() => remove(inst.id)}
                  />
                ))}
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
  onActivate: () => Promise<void>;
  onDeactivate: () => Promise<void>;
  onSetCreds: (creds: unknown) => Promise<void>;
  onRemove: () => Promise<void>;
}): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3 rounded border border-ink-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{props.instance.displayName}</span>
          {props.instance.isActive ? (
            <span className="pill-ok">active</span>
          ) : (
            <span className="pill-muted">inactive</span>
          )}
        </div>
        <div className="font-mono text-xs text-ink-500">
          {props.instance.providerSlug} · {props.authKind} · added{' '}
          {new Date(props.instance.createdAt).toLocaleDateString()}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {props.authKind === 'api-key' && (
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
        {props.instance.isActive ? (
          <button className="btn-secondary" onClick={props.onDeactivate}>
            Deactivate
          </button>
        ) : (
          <button className="btn-primary" onClick={props.onActivate}>
            Set active
          </button>
        )}
        <button className="btn-danger" onClick={props.onRemove}>
          Delete
        </button>
      </div>
    </div>
  );
}
