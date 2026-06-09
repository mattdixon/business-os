#!/usr/bin/env node
/**
 * One-command dev environment bootstrap for Personal Email.
 *
 * Runs identically in WSL bash and Windows PowerShell — just `pnpm dev:all`.
 *
 * Pipeline:
 *   1. docker compose up -d postgres
 *   2. Wait for Postgres to accept connections
 *   3. pnpm migrate          (forward-only, idempotent)
 *   4. pnpm seed:dev         (idempotent — no-ops if already seeded)
 *   5. pnpm dev + pnpm dev:ui in parallel, log lines prefixed [api]/[ui]
 *
 * Ctrl+C tears down the dev + dev:ui children cleanly. Postgres keeps
 * running in the background — stop it with `docker compose down`.
 */

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';

const COLORS = {
  api: '\x1b[36m', // cyan
  ui: '\x1b[35m',  // magenta
  step: '\x1b[33m', // yellow
  ok: '\x1b[32m',  // green
  err: '\x1b[31m', // red
  reset: '\x1b[0m',
};

function step(msg) {
  console.log(`${COLORS.step}▸${COLORS.reset} ${msg}`);
}
function ok(msg) {
  console.log(`${COLORS.ok}✓${COLORS.reset} ${msg}`);
}
function fail(msg) {
  console.error(`${COLORS.err}✗${COLORS.reset} ${msg}`);
}

/**
 * Run a command synchronously, inheriting stdio. Throws on non-zero exit
 * unless allowFail is true (used for idempotent steps like seed:dev).
 */
function run(cmd, args, { allowFail = false } = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
  return result.status === 0;
}

/**
 * Poll Postgres via `docker compose exec postgres pg_isready` until it
 * accepts connections or we hit the timeout. We use pg_isready because
 * it's bundled with the postgres image — no host-side psql required.
 */
async function waitForPostgres({ timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'businessos'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    if (r.status === 0) return;
    await sleep(500);
  }
  throw new Error(`Postgres did not become ready within ${timeoutMs}ms`);
}

/**
 * Spawn `pnpm <script>` with a colored line prefix so api + ui output
 * is distinguishable in a single terminal.
 */
function spawnPrefixed(label, script) {
  const color = COLORS[label] ?? '';
  const prefix = `${color}[${label}]${COLORS.reset} `;
  const child = spawn('pnpm', [script], { shell: process.platform === 'win32' });

  const pipe = (stream, sink) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) sink.write(`${prefix}${line}\n`);
    });
    stream.on('end', () => {
      if (buf) sink.write(`${prefix}${buf}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

async function main() {
  // First-run install. The client shell is its own repo (not part of the
  // framework workspace), so a root-level `pnpm install` doesn't populate
  // node_modules here. Detect the missing `tsx` binary as a proxy for
  // "deps not installed" and run install once.
  const tsxBin = process.platform === 'win32'
    ? 'node_modules/.bin/tsx.cmd'
    : 'node_modules/.bin/tsx';
  if (!existsSync(tsxBin)) {
    step('pnpm install (first run)');
    run('pnpm', ['install']);
  }

  step('docker compose up -d postgres');
  run('docker', ['compose', 'up', '-d', 'postgres']);

  step('waiting for Postgres');
  await waitForPostgres();
  ok('Postgres ready');

  step('pnpm migrate');
  run('pnpm', ['migrate']);

  step('pnpm seed:dev (idempotent)');
  // Seed failures here are usually "already seeded" — keep going so a
  // second `pnpm dev:all` invocation just boots the servers.
  run('pnpm', ['seed:dev'], { allowFail: true });

  step('starting api + ui (Ctrl+C to stop)');
  const api = spawnPrefixed('api', 'dev');
  const ui = spawnPrefixed('ui', 'dev:ui');

  const shutdown = () => {
    api.kill('SIGINT');
    ui.kill('SIGINT');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Exit when either child exits — usually means a crash; the other
  // shouldn't keep running on its own in dev.
  const code = await new Promise((resolve) => {
    api.on('exit', (c) => resolve(c ?? 1));
    ui.on('exit', (c) => resolve(c ?? 1));
  });
  shutdown();
  process.exit(code);
}

main().catch((e) => {
  fail(e.message);
  process.exit(1);
});
