// Tailwind content globs the shell's UI build should add so the UI's classes
// are kept. The shell's tailwind.config.js does:
//
//   import { tailwindContent } from '@frontrangesystems/business-os-ui/tailwind-content';
//   export default {
//     content: ['./src/**/*.{ts,tsx,html}', ...tailwindContent],
//     ...
//   };
//
// Path resolves through the installed @frontrangesystems/business-os-ui package — Tailwind
// supports node_modules globs.
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(here, '..');

export const tailwindContent = [
  resolve(uiRoot, '**/*.{ts,tsx}'),
];
