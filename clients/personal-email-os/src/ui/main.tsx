/**
 * Personal Email — operator UI entry.
 *
 * Imports modules registered by business-os.config + passes their UI pages
 * to createOperatorApp. The Vite build here produces dist-ui/, which core
 * serves at / (preferring it over @business-os/ui's default bundle).
 *
 * To wire in a module's UI pages:
 *   1. Import the module's `./ui` entry below.
 *   2. Add it to `modules: [...]` in the createOperatorApp() call.
 *
 * Example:
 *   import { uiPages as exampleUiPages } from '@business-os/module-example/ui';
 *   createOperatorApp({
 *     modules: [{ slug: 'example', pages: exampleUiPages }],
 *   }).mount(root);
 */

import { createOperatorApp } from '@business-os/ui/app';
import '@business-os/ui/styles.css';
import './ui.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createOperatorApp({
  modules: [
    // { slug: 'example', pages: exampleUiPages },
  ],
}).mount(root);
