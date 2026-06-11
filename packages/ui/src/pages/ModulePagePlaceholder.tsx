import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';

/**
 * Default route handler for /modules/:slug/* in the pre-built @business-os/ui
 * bundle.
 *
 * Module UI pages are React components shipped by the module package — to
 * actually render them, the install's UI bundle has to import the module
 * and pass its pages to the framework's createOperatorApp. The pre-built UI
 * served by core knows nothing about which modules are registered, so it
 * surfaces this placeholder instead and points the operator at the fix.
 *
 * A shell-owned UI build (templates/client-starter/src/ui/main.tsx in a
 * follow-up slice) will replace this placeholder by mounting the actual
 * module pages.
 */
export function ModulePagePlaceholder(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div>
      <PageHeader
        title={`Module: ${slug ?? 'unknown'}`}
        description="This module's UI isn't included in the default UI build."
      />
      <div className="p-8">
        <div className="card max-w-2xl p-6 text-sm text-ink-700 dark:text-ink-300">
          <p className="mb-3">
            The module's <strong>server</strong> side is wired up — its REST routes
            are mounted under <code className="font-mono">/api/modules/{slug}/*</code>{' '}
            and its tables are migrated. You can talk to it with curl.
          </p>
          <p className="mb-3">
            To get its UI pages in here, build a shell-owned UI that imports the
            module's React components and passes them to{' '}
            <code className="font-mono">createOperatorApp(&#123; modulePages &#125;)</code>{' '}
            from <code className="font-mono">@business-os/ui</code>. That builds a
            replacement <code className="font-mono">dist/</code> that core serves
            instead of the default.
          </p>
          <p className="text-ink-500 dark:text-ink-400">
            (Shell-owned UI build lands in the next slice — for now, only the
            module's API is reachable from the browser.)
          </p>
        </div>
      </div>
    </div>
  );
}
