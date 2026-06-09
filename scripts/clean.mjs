#!/usr/bin/env node
/**
 * `pnpm clean` — nuke every node_modules in the workspace + the lockfile.
 *
 * Runs identically in PowerShell and WSL bash. Use after a mixed-OS install
 * leaves leftover files the OS owner can't delete (e.g. WSL-uid-owned
 * `.ignored_postcss` blocking PowerShell) or before a fresh install.
 *
 * After running:
 *   pnpm install
 *   pnpm dev:cm     # (or dev:personal, etc.)
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLORS = {
  step: '\x1b[33m',
  ok: '\x1b[32m',
  err: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};
const step = (m) => console.log(`${COLORS.step}▸${COLORS.reset} ${m}`);
const ok = (m) => console.log(`${COLORS.ok}✓${COLORS.reset} ${m}`);
const dim = (m) => console.log(`${COLORS.dim}${m}${COLORS.reset}`);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Walk the workspace and collect every `node_modules` directory. We skip
 * inside node_modules itself (nested deps don't need a separate sweep —
 * deleting the parent kills them) and skip dot-directories like .git that
 * would never contain workspace packages.
 */
function findNodeModules(root) {
  const found = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === 'node_modules') {
        found.push(join(dir, ent.name));
        continue; // don't descend into node_modules
      }
      if (ent.name.startsWith('.')) continue; // .git, .turbo, .a5c, etc.
      if (ent.name === 'dist') continue;
      queue.push(join(dir, ent.name));
    }
  }
  return found;
}

function nuke(path) {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error(`${COLORS.err}✗${COLORS.reset} could not remove ${path}: ${err.message}`);
    return false;
  }
}

function main() {
  step(`searching ${repoRoot}`);
  const dirs = findNodeModules(repoRoot);
  if (dirs.length === 0) {
    ok('no node_modules directories — nothing to do');
  } else {
    step(`removing ${dirs.length} node_modules ${dirs.length === 1 ? 'directory' : 'directories'}`);
    for (const d of dirs) {
      const rel = d.slice(repoRoot.length + 1);
      const sizeHint = (() => {
        try {
          return statSync(d).isDirectory() ? '' : '';
        } catch {
          return '';
        }
      })();
      dim(`  ${rel}${sizeHint}`);
      nuke(d);
    }
    ok(`removed ${dirs.length} node_modules`);
  }

  const lock = join(repoRoot, 'pnpm-lock.yaml');
  if (existsSync(lock)) {
    step('removing pnpm-lock.yaml');
    nuke(lock);
    ok('lockfile removed');
  }

  console.log('');
  ok('done. next:');
  dim('  pnpm install');
  dim('  pnpm dev:cm   # (or dev:personal)');
}

main();
