#!/usr/bin/env node
import { resolve } from 'node:path';
import { scaffoldClient } from './index.js';

interface CliArgs {
  slug?: string;
  name?: string;
  dir?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (!a.startsWith('-') && !args.slug) args.slug = a;
  }
  return args;
}

const HELP = `\
Usage: create-business-os-client <slug> [--name "Display Name"] [--dir ./path]

Scaffolds a new Business OS client install repo.

Positional:
  slug         kebab-case identifier (e.g. cnn-construction)

Options:
  --name STR   Human-readable display name (default: title-cased slug)
  --dir PATH   Target directory (default: ./<slug>-os)
  --help, -h   Show this help

Example:
  pnpm create business-os-client cnn-construction \\
    --name "CNN Construction"

After it runs:
  cd <slug>-os
  pnpm install
  docker compose up -d postgres
  pnpm dev
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.slug) {
    // eslint-disable-next-line no-console
    console.log(HELP);
    process.exit(args.slug ? 0 : 1);
  }

  const targetDir = resolve(args.dir ?? `./${args.slug}-os`);
  try {
    const result = await scaffoldClient({
      slug: args.slug,
      name: args.name,
      targetDir,
    });
    // eslint-disable-next-line no-console
    console.log(`\n  ✓ Scaffolded ${result.name} into ${result.targetDir}`);
    // eslint-disable-next-line no-console
    console.log(`  ✓ Wrote ${result.filesWritten.length} files`);
    if (result.generatedSecretsKey) {
      // eslint-disable-next-line no-console
      console.log(`  ✓ Generated a SECRETS_KEY in .env.example`);
    }
    // eslint-disable-next-line no-console
    console.log(`\nNext steps:`);
    // eslint-disable-next-line no-console
    console.log(`  cd ${result.targetDir.replace(process.cwd() + '/', './')}`);
    // eslint-disable-next-line no-console
    console.log(`  cp .env.example .env`);
    // eslint-disable-next-line no-console
    console.log(`  pnpm install`);
    // eslint-disable-next-line no-console
    console.log(`  docker compose up -d postgres`);
    // eslint-disable-next-line no-console
    console.log(`  pnpm dev\n`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`create-business-os-client: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
