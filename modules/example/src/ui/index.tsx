import { useEffect, useState, type FormEvent } from 'react';
import type { ModuleUiPage } from '@business-os/module-sdk';

/**
 * UI half of @business-os/module-example.
 *
 * Operator UI imports this and renders ExampleNotesPage at
 * /modules/example. The page talks to the module's own REST routes
 * (mounted at /api/modules/example/notes by core).
 *
 * Modules ship their UI as a normal React component — no special API
 * surface beyond what's already in the framework. They share core's auth
 * cookie automatically because fetch goes to the same origin.
 */

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(text || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export function ExampleNotesPage(): JSX.Element {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const r = await fetchJson<{ notes: Note[] }>('/api/modules/example/notes');
      setNotes(r.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const create = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    try {
      await fetchJson('/api/modules/example/notes', {
        method: 'POST',
        body: JSON.stringify({ title, body }),
      });
      setTitle('');
      setBody('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!confirm('Delete this note?')) return;
    try {
      await fetchJson(`/api/modules/example/notes/${id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    }
  };

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold">Example module — notes</h1>
        <p className="text-sm text-ink-500">
          Minimal proof that modules own their own data + UI. This whole page
          is shipped by <code className="font-mono">@business-os/module-example</code>.
        </p>
      </header>

      <form onSubmit={create} className="card mb-6 space-y-3 p-5">
        <div>
          <label className="label">Title</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Body</label>
          <textarea
            className="input"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
        <button className="btn-primary" type="submit" disabled={!title.trim()}>
          Add note
        </button>
      </form>

      {!notes ? (
        <div className="text-ink-500">Loading…</div>
      ) : notes.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">No notes yet.</div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="card flex justify-between gap-4 p-4">
              <div>
                <div className="font-medium">{n.title}</div>
                {n.body && <div className="mt-1 text-sm text-ink-700">{n.body}</div>}
                <div className="mt-2 text-xs text-ink-400">
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
              <button className="btn-danger self-start" onClick={() => void remove(n.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * UI pages contributed to the operator app. The client shell's UI entry
 * imports this list and feeds it to @business-os/ui's createOperatorApp.
 */
export const uiPages: ModuleUiPage[] = [
  { path: '', navLabel: 'Example notes', Component: ExampleNotesPage },
];
