import type { ReactNode } from 'react';

export function PageHeader(props: {
  title: string;
  description?: string;
  right?: ReactNode;
}): JSX.Element {
  return (
    <header className="border-b border-ink-200 bg-white px-8 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-900">{props.title}</h1>
          {props.description && (
            <p className="mt-1 text-sm text-ink-500">{props.description}</p>
          )}
        </div>
        {props.right}
      </div>
    </header>
  );
}
