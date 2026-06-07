/**
 * Export helpers — derive CSV / Markdown from common agent result shapes
 * (the leadgen/prospecting `details.drafts` shape, in particular).
 *
 * Client-side only. Triggers a file download via a synthetic <a> click.
 */

interface DraftLike {
  prospect?: {
    company?: string;
    role?: string;
    why?: string;
  };
  outreach?: {
    subject?: string;
    body?: string;
  };
}

interface ProspectingDraftLike {
  research?: string;
  outreach?: {
    subject?: string;
    body?: string;
  };
}

export interface RunExportable {
  details: unknown;
  agentSlug?: string;
}

/** Best-effort: pull an array of drafts off a leadgen-shaped result. */
function asLeadgenDrafts(details: unknown): DraftLike[] | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as { drafts?: unknown };
  if (!Array.isArray(d.drafts)) return null;
  return d.drafts as DraftLike[];
}

function asProspectingDraft(details: unknown): ProspectingDraftLike | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as { draft?: unknown };
  if (!d.draft || typeof d.draft !== 'object') return null;
  return d.draft as ProspectingDraftLike;
}

function escapeCsv(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function detailsToCsv(run: RunExportable): string | null {
  const drafts = asLeadgenDrafts(run.details);
  if (drafts && drafts.length > 0) {
    const headers = ['company', 'role', 'why', 'subject', 'body'];
    const rows = drafts.map((d) =>
      [
        d.prospect?.company,
        d.prospect?.role,
        d.prospect?.why,
        d.outreach?.subject,
        d.outreach?.body,
      ]
        .map(escapeCsv)
        .join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }
  const single = asProspectingDraft(run.details);
  if (single) {
    const headers = ['research', 'subject', 'body'];
    const row = [single.research, single.outreach?.subject, single.outreach?.body]
      .map(escapeCsv)
      .join(',');
    return [headers.join(','), row].join('\n');
  }
  return null;
}

export function detailsToMarkdown(run: RunExportable): string | null {
  const drafts = asLeadgenDrafts(run.details);
  if (drafts && drafts.length > 0) {
    const sections = drafts.map(
      (d, i) =>
        `## ${i + 1}. ${d.prospect?.company ?? 'Unknown'} — ${d.prospect?.role ?? '—'}\n\n` +
        `_${d.prospect?.why ?? ''}_\n\n` +
        `**Subject:** ${d.outreach?.subject ?? ''}\n\n` +
        `${d.outreach?.body ?? ''}\n`,
    );
    return `# Drafts (${drafts.length})\n\n${sections.join('\n---\n\n')}`;
  }
  const single = asProspectingDraft(run.details);
  if (single) {
    return (
      `# Prospecting draft\n\n` +
      `## Research\n\n${single.research ?? '—'}\n\n` +
      `## Outreach\n\n**Subject:** ${single.outreach?.subject ?? ''}\n\n` +
      `${single.outreach?.body ?? ''}\n`
    );
  }
  return null;
}

export function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
