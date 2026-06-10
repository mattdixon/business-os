/**
 * Human labels for capability slugs.
 *
 * The framework uses kebab-case slugs (`email-inbox`, `file-storage`, `llm`)
 * everywhere as the identity of a capability. They're great for grepping
 * audit logs and identifying things in code, but they leak developer
 * jargon into the operator UI. Every place the operator sees a capability
 * heading should render the label here, optionally with the slug as a
 * `font-mono` aside.
 *
 * Unknown slugs fall back to a title-cased version so a future capability
 * has a reasonable default before its label lands here.
 */
const CAPABILITY_LABELS: Record<string, string> = {
  llm: 'LLM',
  email: 'Email (send)',
  'email-inbox': 'Email inbox',
  crm: 'CRM',
  'file-storage': 'File storage',
};

export function capabilityLabel(slug: string): string {
  if (slug in CAPABILITY_LABELS) return CAPABILITY_LABELS[slug]!;
  return slug
    .split(/[-_]/)
    .map((s) => (s.length === 0 ? '' : s[0]!.toUpperCase() + s.slice(1)))
    .join(' ');
}
