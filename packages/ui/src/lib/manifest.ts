/**
 * Path constants used by @business-os/core to locate built UI assets at
 * runtime. Kept free of node:* imports so this file typechecks under the
 * UI's browser-only tsconfig.
 */

/** Relative path from this file (src/lib/manifest.ts) to the Vite dist dir. */
export const UI_DIST_REL = '../../dist';
