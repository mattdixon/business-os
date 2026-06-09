import { useState, type ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';

/**
 * Confirm dialog built on Radix Alert Dialog. Use for destructive
 * actions (delete, disconnect, overwrite). Styled with our existing
 * Tailwind tokens — no external CSS.
 *
 * Two ways to use:
 *
 *   1. Controlled — bind `open` + `onOpenChange`. Use when the trigger
 *      is several components away from the dialog.
 *
 *   2. Uncontrolled with a trigger child — pass `<ConfirmDialog.Trigger>`
 *      as children, the dialog manages its own open state.
 *
 * Example (uncontrolled):
 *
 *   <ConfirmDialog
 *     title="Delete connector instance?"
 *     description="Credentials will be wiped. This can't be undone."
 *     confirmLabel="Delete"
 *     variant="danger"
 *     onConfirm={async () => Api.deleteConnector(id)}
 *   >
 *     <button className="btn-danger">Delete</button>
 *   </ConfirmDialog>
 */

export interface ConfirmDialogProps {
  title: string;
  description?: ReactNode;
  /** Confirm button label. Default: "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Default: "Cancel". */
  cancelLabel?: string;
  /**
   * Visual treatment for the confirm button.
   *   'danger'  — red, for destructive ops (delete, wipe)
   *   'primary' — accent, for non-destructive confirmations
   * Default: 'danger' (this component is for confirms; if it's not
   * dangerous you probably want a plain modal, not this).
   */
  variant?: 'danger' | 'primary';
  /**
   * Called when the user confirms. May return a Promise — the dialog
   * disables its buttons + shows "Working…" until it resolves. If it
   * rejects, the error message is shown inline and the dialog stays
   * open so the operator can retry or cancel.
   */
  onConfirm: () => void | Promise<void>;
  /** External open state. Pair with onOpenChange. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Trigger element. When provided, the dialog manages its own open
   * state and clicking the trigger opens it. When omitted, use
   * controlled mode via open/onOpenChange.
   */
  children?: ReactNode;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const {
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    onConfirm,
    open,
    onOpenChange,
    children,
  } = props;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmClass = variant === 'danger' ? 'btn-danger' : 'btn-primary';

  const handleConfirm = async (e: React.MouseEvent) => {
    // Stop Radix from closing the dialog until we know whether the
    // action succeeded — failed actions keep the dialog open with the
    // error visible.
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange?.(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange?.(next);
      }}
    >
      {children && <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 card p-6 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <AlertDialog.Title className="text-base font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            {title}
          </AlertDialog.Title>
          {description && (
            <AlertDialog.Description className="mt-2 text-sm text-ink-600 dark:text-ink-400">
              {description}
            </AlertDialog.Description>
          )}
          {error && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button className="btn-secondary" disabled={busy}>
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
            <button className={confirmClass} disabled={busy} onClick={handleConfirm}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
