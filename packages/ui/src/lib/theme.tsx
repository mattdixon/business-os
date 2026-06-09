import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Api, type Theme } from './api';

/**
 * Theme management.
 *
 * - `preference` is what the user selected: 'light', 'dark', or 'system'.
 * - `resolved` is the effective theme actually applied: 'light' or 'dark'.
 *   When preference is 'system' we listen to prefers-color-scheme.
 *
 * The `dark` class on <html> is the single source of truth for Tailwind's
 * `dark:` variants. We also pre-set it from localStorage in index.html
 * (theme-boot script) to avoid a flash of wrong theme on first paint;
 * once /auth/me loads, this provider reconciles with the server value.
 */

interface ThemeCtx {
  preference: Theme;
  resolved: 'light' | 'dark';
  /** Persists to the server. Updates UI immediately. */
  setPreference: (next: Theme) => Promise<void>;
}

const Ctx = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = 'bos:theme';

function readStoredPreference(): Theme {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(pref: Theme): 'light' | 'dark' {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function applyToDocument(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [preference, setPref] = useState<Theme>(() => readStoredPreference());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(readStoredPreference()));

  // Reconcile with server pref once /auth/me has resolved. We don't block
  // on this: the localStorage value is already applied at boot.
  useEffect(() => {
    let cancelled = false;
    void Api.me()
      .then((me) => {
        if (cancelled || !me.preferences?.theme) return;
        if (me.preferences.theme === preference) return;
        setPref(me.preferences.theme);
        window.localStorage.setItem(STORAGE_KEY, me.preferences.theme);
      })
      .catch(() => {
        /* anonymous or network — keep local pref */
      });
    return () => {
      cancelled = true;
    };
  }, []); // run once

  // Re-resolve whenever preference changes; also subscribe to OS changes
  // when preference is 'system'.
  useEffect(() => {
    const next = resolve(preference);
    setResolved(next);
    applyToDocument(next);

    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const r = systemPrefersDark() ? 'dark' : 'light';
      setResolved(r);
      applyToDocument(r);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const setPreference: ThemeCtx['setPreference'] = async (next) => {
    // Optimistic: apply locally first so the UI flips instantly even on slow
    // connections. If the PATCH fails the user can retry — we surface no
    // toast here because this is the kind of change you discover visually.
    setPref(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    try {
      await Api.updatePreferences({ theme: next });
    } catch {
      /* server write failed; the local pref still stands */
    }
  };

  return <Ctx.Provider value={{ preference, resolved, setPreference }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside of ThemeProvider');
  return v;
}

/**
 * Inline script string for index.html that sets the `dark` class on <html>
 * BEFORE React mounts, eliminating flash-of-wrong-theme. Reads localStorage
 * with the same key used above; defaults to system.
 */
export const themeBootScript = `
(function(){
  try {
    var k = '${STORAGE_KEY}';
    var v = localStorage.getItem(k) || 'system';
    var dark = v === 'dark' || (v === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (_) {}
})();
`;
