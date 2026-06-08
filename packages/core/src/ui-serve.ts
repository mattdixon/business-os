import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Static-serve the operator UI at /.
 *
 * Two sources, in order of preference:
 *   1. The client shell's own UI build at <CWD>/dist-ui (or wherever
 *      shellUiDist points). This is what a shell that has registered
 *      modules produces via its own Vite config — the bundle includes
 *      module UI pages.
 *   2. @business-os/ui's default pre-built dist. No modules wired in —
 *      module pages render as a placeholder explaining how to switch
 *      to a shell-owned build.
 *
 * If neither exists, this is a warn-and-no-op so the API still works.
 */

const require = createRequire(import.meta.url);

export interface UiServeOpts {
  /** Override the UI package root for the default fallback bundle. */
  uiPackageRoot?: string;
  /**
   * Absolute path to the shell's own UI build. Defaults to
   * `<CWD>/dist-ui`. Set explicitly when the shell isn't in CWD (tests).
   */
  shellUiDist?: string;
}

export function registerUiServe(
  app: FastifyInstance,
  opts: UiServeOpts = {},
): void {
  // 1. Shell-owned UI build wins when present.
  const shellDist = opts.shellUiDist ?? resolve(process.cwd(), 'dist-ui');
  if (existsSync(join(shellDist, 'index.html'))) {
    mount(app, shellDist, 'shell-owned UI');
    return;
  }

  // 2. Fall back to @business-os/ui's pre-built default bundle.
  let pkgRoot: string;
  try {
    const pkgJsonPath =
      opts.uiPackageRoot ?? require.resolve('@business-os/ui/package.json');
    pkgRoot = opts.uiPackageRoot ?? dirname(pkgJsonPath);
  } catch {
    app.log.warn('@business-os/ui not resolvable; UI serving disabled.');
    return;
  }

  const dist = join(pkgRoot, 'dist');
  if (!existsSync(dist)) {
    app.log.warn(
      { dist, shellDist },
      'No UI bundle found. Build the shell UI (`pnpm build:ui`) or @business-os/ui (`pnpm --filter @business-os/ui build`).',
    );
    return;
  }

  mount(app, dist, '@business-os/ui default bundle');
}

function mount(app: FastifyInstance, root: string, label: string): void {
  app.log.info({ root, label }, 'UI: serving static assets');

  void app.register(fastifyStatic, {
    root,
    prefix: '/',
    wildcard: false,
  });

  // Fallback: any HTML-ish request that didn't match a route or static asset
  // returns the SPA shell so react-router can render. API + auth routes still
  // 404 normally (they end in JSON, not HTML).
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? '';
    if (
      url.startsWith('/api') ||
      url.startsWith('/auth') ||
      url.startsWith('/healthz') ||
      url.startsWith('/readyz')
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });
}
