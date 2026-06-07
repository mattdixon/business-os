import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/**
 * Minimal toast system. No external dep.
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast.success('Saved');
 *   toast.error('Save failed');
 *
 * Renders a fixed stack in the bottom-right. Each toast auto-dismisses
 * after 4s; click to dismiss early.
 */

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

interface ToastCtx {
  toast: ToastApi;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Toast['kind'], message: string): void => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <Ctx.Provider value={{ toast: api }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={
              'pointer-events-auto max-w-sm rounded border px-4 py-2 text-left text-sm shadow-md transition ' +
              (t.kind === 'success'
                ? 'border-green-200 bg-green-50 text-green-900'
                : t.kind === 'error'
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-ink-200 bg-white text-ink-900')
            }
          >
            {t.message}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast outside of ToastProvider');
  return v;
}
