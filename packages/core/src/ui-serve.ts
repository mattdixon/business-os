import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Static-serve the @business-os/ui Vite build at /.
 *
 * Resolves the UI package's installed location and serves its built dist/
 * directory. Any path not handled by /auth, /api, /healthz, /readyz falls
 * back to index.html so the SPA router can take over.
 *
 * If the dist directory hasn't been built (e.g. during framework dev), this
 * is a no-op + a warning. Production builds will have run the UI build as
 * part of `pnpm build`.
 */

const require = createRequire(import.meta.url);

export interface UiServeOpts {
  /**
   * Override the UI package root. By default we resolve @business-os/ui
   * from this package's node_modules.
   */
  uiPackageRoot?: string;
}

export function registerUiServe(
  app: FastifyInstance,
  opts: UiServeOpts = {},
): void {
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
      { dist },
      '@business-os/ui dist/ not found; run `pnpm --filter @business-os/ui build`. UI serving disabled.',
    );
    return;
  }

  void app.register(fastifyStatic, {
    root: dist,
    prefix: '/',
    // SPA fallback handled below via setNotFoundHandler.
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
