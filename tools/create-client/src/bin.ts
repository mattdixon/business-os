#!/usr/bin/env node
import { resolve } from 'node:path';
import { scaffoldClient } from './index.js';

interface CliArgs {
  slug?: string;
  name?: string;
  dir?: string;
  workspaceMode?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--workspace-mode') args.workspaceMode = true;
    else if (!a.startsWith('-') && !args.slug) args.slug = a;
  }
  return args;
}

const HELP = `\
Usage: create-business-os-client <slug> [options]

Scaffolds a new Business OS client install repo.

Positional:
  slug              kebab-case identifier (e.g. c-and-m-construction)

Options:
  --name STR        Human-readable display name (default: title-cased slug)
  --dir PATH        Target directory (default: ./<slug>-os)
  --workspace-mode  Place the scaffold inside an existing pnpm workspace
                    and auto-register it in pnpm-workspace.yaml. Required
                    until @business-os/* are published to a registry.
  --help, -h        Show this help

Examples:
  # Scaffold a standalone shell (requires @business-os/* to be published):
  pnpm create business-os-client c-and-m-construction --name "C&M Construction"

  # Scaffold into the framework monorepo so workspace:^ deps resolve locally:
  pnpm create business-os-client c-and-m-construction \\
    --dir ./clients/c-and-m-construction-os \\
    --workspace-mode

After it runs (workspace-mode):
  pnpm install                      # in the monorepo root
  docker compose up -d postgres     # in the new client dir
  cp .env.example .env
  pnpm dev                          # in the new client dir
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
      workspaceMode: args.workspaceMode,
    });
    const rel = (p: string): string => p.replace(process.cwd() + '/', './');
    /* eslint-disable no-console */
    console.log(`\n  ✓ Scaffolded ${result.name} into ${rel(result.targetDir)}`);
    console.log(`  ✓ Wrote ${result.filesWritten.length} files`);
    if (result.generatedSecretsKey) {
      console.log(`  ✓ Generated a SECRETS_KEY in .env.example`);
    }
    if (result.workspace) {
      if (result.workspace.alreadyPresent) {
        console.log(
          `  ✓ Already registered in ${rel(result.workspace.yamlPath)} (no change)`,
        );
      } else {
        console.log(
          `  ✓ Added "${result.workspace.packagesEntry}" to ${rel(result.workspace.yamlPath)}`,
        );
      }
    }

    console.log(`\nNext steps:`);
    if (result.workspace) {
      const ws = resolve(result.workspace.yamlPath, '..');
      console.log(`  cd ${rel(ws)}`);
      console.log(`  pnpm install            # installs the new package into the workspace`);
      console.log(`  cd ${rel(result.targetDir)}`);
      console.log(`  cp .env.example .env`);
      console.log(`  docker compose up -d postgres`);
      console.log(`  pnpm dev\n`);
      console.log(`Once Postgres is up + the app is running, in another terminal:`);
      console.log(`  pnpm seed:dev           # creates admin@localhost + sample settings\n`);
    } else {
      console.log(`  cd ${rel(result.targetDir)}`);
      console.log(`  cp .env.example .env`);
      console.log(`  pnpm install`);
      console.log(`  docker compose up -d postgres`);
      console.log(`  pnpm dev\n`);
      console.log(
        `Note: \`pnpm install\` will fail until @business-os/* are published to your`,
      );
      console.log(
        `registry. While that's still being decided, scaffold with --workspace-mode`,
      );
      console.log(`pointed at the framework monorepo and consume the workspace deps locally.\n`);
    }
    /* eslint-enable no-console */
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`create-business-os-client: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
