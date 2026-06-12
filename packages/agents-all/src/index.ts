/**
 * @frontrangesystems/business-os-agents-all
 *
 * Re-exports every framework-shipped agent. Client shells import this one
 * package and call `registry.registerManyAgents(allFrameworkAgents)` — no
 * per-agent imports needed. Adding a new framework agent becomes "ship the
 * package + add it here," with zero client-side code changes.
 *
 * Whether an agent is *enabled for this install* (shows up on /agents and
 * actually runs) is controlled by the operator UI's Add Agent flow, not by
 * what's registered. Everything in this file ships to every install; the
 * operator picks which to install.
 */

import inboxCategorize from '@frontrangesystems/business-os-agent-inbox-categorize';
import inboxCleanup from '@frontrangesystems/business-os-agent-inbox-cleanup';
import inboxSurface from '@frontrangesystems/business-os-agent-inbox-surface';
import leadgen from '@frontrangesystems/business-os-agent-leadgen';
import prospecting from '@frontrangesystems/business-os-agent-prospecting';
import digest from '@frontrangesystems/business-os-agent-digest';

import type { AgentManifest, AgentRun } from '@frontrangesystems/business-os-agent-sdk';

interface FrameworkAgent {
  manifest: AgentManifest;
  run: AgentRun;
}

/**
 * Every framework agent, in catalog order. Order doesn't affect runtime
 * behavior; it controls the default visual order in the Add Agent picker
 * before the operator has any installed.
 */
/**
 * Cast through `unknown` because each agent declares a different
 * `settingsSchema` shape. The registry uses a homogeneous Map<slug,
 * RegisteredAgent> at runtime; the per-agent type is enforced inside the
 * agent's own `run()` via Zod, not at the registry boundary.
 */
export const allFrameworkAgents: FrameworkAgent[] = [
  inboxSurface as unknown as FrameworkAgent,
  inboxCategorize as unknown as FrameworkAgent,
  inboxCleanup as unknown as FrameworkAgent,
  leadgen as unknown as FrameworkAgent,
  prospecting as unknown as FrameworkAgent,
  digest as unknown as FrameworkAgent,
];

// Re-export the named agents so a shell that needs one specifically
// (test fixtures, custom wiring) can still import by name.
export {
  inboxSurface,
  inboxCategorize,
  inboxCleanup,
  leadgen,
  prospecting,
  digest,
};
