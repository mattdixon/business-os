import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Api, ApiError, type ConnectorCapability } from '../lib/api';
import { capabilityLabel } from '../lib/capability-labels';
import { apiErrorMessage } from '../lib/api-errors';
import { SchemaForm, defaultFor, type FieldSchema } from '../components/SchemaForm';
import { useToast } from '../lib/toast';

/**
 * Multi-step Add Agent dialog. Three phases in one modal:
 *
 *   1. Pick — list the agents this install knows about but the operator
 *      hasn't enabled yet (from GET /api/agents/available).
 *   2. Configure — render the agent's settingsSchema pre-filled with
 *      defaults; auto-bind the first active instance per required
 *      connector capability with a dropdown to change.
 *   3. Confirm — single POST /api/agents/:slug/enable with the chosen
 *      settings + bindings.
 *
 * Closing the dialog at any phase discards in-progress configuration.
 * Operator can reopen and start fresh.
 */

interface AvailableAgent {
  slug: string;
  version: string;
  displayName: string;
  description: string;
  requiredConnectors: ReadonlyArray<string>;
  schedule: { kind: 'cron'; expr: string } | { kind: 'manual' } | { kind: 'event'; topic: string };
  settingsSchema?: unknown;
}

export function AddAgentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful enable so the caller can refetch. */
  onEnabled: () => void;
}): JSX.Element {
  const { toast } = useToast();
  const [available, setAvailable] = useState<AvailableAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<AvailableAgent | null>(null);
  const [draftSettings, setDraftSettings] = useState<unknown>({});
  const [draftBindings, setDraftBindings] = useState<Record<string, string>>({});
  const [caps, setCaps] = useState<ConnectorCapability[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (!props.open) return;
    setAvailable(null);
    setPicked(null);
    setDraftSettings({});
    setDraftBindings({});
    setBusy(false);
    setError(null);
    Promise.all([Api.listAvailableAgents(), Api.listConnectors()])
      .then(([a, c]) => {
        setAvailable(a.agents);
        setCaps(c.capabilities);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'load failed'));
  }, [props.open]);

  // When the operator picks an agent, pre-fill settings with defaults and
  // pre-bind each capability to the first active instance.
  const pickAgent = (agent: AvailableAgent): void => {
    setPicked(agent);
    const schema = agent.settingsSchema as FieldSchema | undefined;
    setDraftSettings(schema ? defaultFor(schema) : {});
    const bindings: Record<string, string> = {};
    for (const cap of agent.requiredConnectors) {
      const first = caps
        ?.find((c) => c.capability === cap)
        ?.instances.find((i) => i.isActive);
      if (first) bindings[cap] = first.id;
    }
    setDraftBindings(bindings);
  };

  const confirmEnable = async (): Promise<void> => {
    if (!picked) return;
    setBusy(true);
    try {
      const clean = Object.fromEntries(
        Object.entries(draftBindings).filter(([, v]) => v && v.length > 0),
      );
      await Api.enableAgent(picked.slug, {
        settings: draftSettings,
        bindings: clean,
      });
      toast.success(`${picked.displayName} installed.`);
      props.onOpenChange(false);
      props.onEnabled();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Install failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl dark:bg-ink-900">
          <div className="border-b border-ink-200 px-6 py-4 dark:border-ink-700">
            <Dialog.Title className="text-lg font-semibold tracking-tight">
              {picked ? `Install ${picked.displayName}` : 'Add agent'}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              {picked
                ? 'Pick connectors and tweak defaults. You can change anything later from the agent page.'
                : 'These agents are available on this install. Pick one to configure and enable.'}
            </Dialog.Description>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
                {error}
              </div>
            )}
            {!available ? (
              <div className="text-sm text-ink-500 dark:text-ink-400">Loading…</div>
            ) : !picked ? (
              available.length === 0 ? (
                <div className="rounded border border-dashed border-ink-200 px-3 py-10 text-center text-sm text-ink-500 dark:border-ink-700 dark:text-ink-400">
                  Every agent this install knows about is already enabled. To
                  add new agents, install the package on the server and add it
                  to <code className="font-mono text-xs">@frontrangesystems/business-os-agents-all</code>.
                </div>
              ) : (
                <ul className="space-y-2">
                  {available.map((a) => (
                    <li key={a.slug}>
                      <button
                        className="w-full rounded-md border border-ink-200 p-4 text-left transition-colors hover:border-accent hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
                        onClick={() => pickAgent(a)}
                      >
                        <div className="font-medium text-ink-900 dark:text-ink-100">
                          {a.displayName}
                          <span className="ml-2 font-mono text-xs font-normal text-ink-500 dark:text-ink-400">
                            {a.slug} · v{a.version}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                          {a.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-500 dark:text-ink-400">
                          {a.requiredConnectors.map((cap) => (
                            <span
                              key={cap}
                              className="rounded bg-ink-100 px-1.5 py-0.5 dark:bg-ink-800"
                            >
                              {capabilityLabel(cap)}
                            </span>
                          ))}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                    Connectors
                  </h3>
                  <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">
                    Pre-bound to the first active instance per capability. Change if you want.
                  </p>
                  <div className="space-y-3">
                    {picked.requiredConnectors.map((cap) => {
                      const capDef = caps?.find((c) => c.capability === cap);
                      const options = capDef?.instances.filter((i) => i.isActive) ?? [];
                      const value = draftBindings[cap] ?? '';
                      return (
                        <div
                          key={cap}
                          className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[180px_1fr]"
                        >
                          <span className="text-sm text-ink-700 dark:text-ink-300">
                            {capabilityLabel(cap)}
                            <span className="ml-1.5 font-mono text-xs text-ink-500 dark:text-ink-400">
                              {cap}
                            </span>
                          </span>
                          {options.length === 0 ? (
                            <div className="text-xs text-ink-500 dark:text-ink-400">
                              No connected instances yet — add one on the Connectors page first.
                            </div>
                          ) : (
                            <select
                              className="input"
                              value={value}
                              onChange={(e) =>
                                setDraftBindings((prev) => ({
                                  ...prev,
                                  [cap]: e.target.value,
                                }))
                              }
                            >
                              <option value="">— pick one —</option>
                              {options.map((inst) => (
                                <option key={inst.id} value={inst.id}>
                                  {inst.displayName}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {picked.settingsSchema ? (
                  <div>
                    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                      Settings
                    </h3>
                    <SchemaForm
                      schema={picked.settingsSchema as FieldSchema}
                      value={draftSettings}
                      onChange={setDraftSettings}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-ink-200 px-6 py-4 dark:border-ink-700">
            {picked && (
              <button
                className="btn-ghost"
                onClick={() => setPicked(null)}
                disabled={busy}
              >
                ← Back
              </button>
            )}
            <div className="flex-1" />
            <Dialog.Close asChild>
              <button className="btn-ghost" disabled={busy}>
                Cancel
              </button>
            </Dialog.Close>
            {picked && (
              <button
                className="btn-primary"
                onClick={confirmEnable}
                disabled={busy}
              >
                {busy ? 'Installing…' : 'Install agent'}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
