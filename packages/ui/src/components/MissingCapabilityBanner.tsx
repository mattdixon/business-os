import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Api, type AgentSummary, type ConnectorCapability } from '../lib/api';
import { capabilityLabel } from '../lib/capability-labels';

/**
 * Compute capabilities that are required by at least one enabled agent but
 * have no instance that is both active AND has credentials saved.
 *
 * "Required" means listed in the agent manifest's requiredConnectors. An
 * agent in the inventory is considered enabled when listAgents() returns
 * it (the API filters disabled agents out before responding).
 *
 * Returns the slug list; the caller turns slugs into human labels with
 * capabilityLabel().
 */
export function computeMissingCapabilities(
  agents: AgentSummary[],
  caps: ConnectorCapability[],
  filter?: ReadonlyArray<string>,
): string[] {
  const required = new Set<string>();
  for (const a of agents) {
    for (const r of a.requiredConnectors) required.add(r);
  }
  const candidates = filter ? [...required].filter((r) => filter.includes(r)) : [...required];
  return candidates.filter((slug) => {
    const cap = caps.find((c) => c.capability === slug);
    if (!cap) return true;
    return !cap.instances.some((i) => i.isActive && i.hasCredentials);
  });
}

/**
 * Banner that warns the operator when a capability required by an enabled
 * agent has no working connector instance. Use on the Dashboard (no
 * `forCapabilities` — surface every gap) and on AgentDetail (pass the
 * agent's requiredConnectors so only its gaps show).
 *
 * Hidden when nothing is missing. v1 shows to every authenticated user —
 * there's no admin/user split yet (single-tenant operator console).
 */
export function MissingCapabilityBanner({
  forCapabilities,
}: {
  /** When set, restrict the warning to this subset of capabilities. */
  forCapabilities?: ReadonlyArray<string>;
}): JSX.Element | null {
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [agentsRes, capsRes] = await Promise.all([
          Api.listAgents(),
          Api.listConnectors(),
        ]);
        if (cancelled) return;
        setMissing(
          computeMissingCapabilities(
            agentsRes.agents,
            capsRes.capabilities,
            forCapabilities,
          ),
        );
      } catch {
        if (!cancelled) setMissing([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [forCapabilities?.join(',')]);

  if (!missing || missing.length === 0) return null;

  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
      <div className="font-semibold">
        {missing.length === 1 ? 'A capability needs configuring' : 'Capabilities need configuring'}
      </div>
      <div className="mt-1">
        {missing.length === 1 ? (
          <>
            <strong>{capabilityLabel(missing[0]!)}</strong> has no active connector with saved
            credentials. Agents that need it will fail at run time.
          </>
        ) : (
          <>
            The following capabilities have no active connector with saved credentials, and
            agents that need them will fail at run time:{' '}
            {missing.map((slug, i) => (
              <span key={slug}>
                {i > 0 && ', '}
                <strong>{capabilityLabel(slug)}</strong>
              </span>
            ))}
            .
          </>
        )}
      </div>
      <div className="mt-2">
        <Link to="/connectors" className="font-medium text-amber-900 underline dark:text-amber-100">
          Configure connectors →
        </Link>
      </div>
    </div>
  );
}
