import type { ReactNode } from 'react';

export function PageHeader(props: {
  title: string;
  description?: string;
  right?: ReactNode;
}): JSX.Element {
  return (
    <header className="border-b border-ink-200 bg-white px-6 py-6 sm:px-8 dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
            {props.title}
          </h1>
          {props.description && (
            <p className="mt-1 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
              {props.description}
            </p>
          )}
        </div>
        {props.right && <div className="shrink-0">{props.right}</div>}
      </div>
    </header>
  );
}
