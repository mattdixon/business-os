import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  stat,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Programmatic API for the create-client CLI.
 *
 * Splitting this out from bin.ts lets us test it without spawning a process.
 */

export interface ScaffoldOptions {
  /** kebab-case slug. Used in package name, env vars, container names. */
  slug: string;
  /** Human-readable display name. Defaults to a Title-Case of the slug. */
  name?: string;
  /** Absolute path where the new repo should be written. */
  targetDir: string;
  /** Override the path to the template dir. Defaults to the bundled template. */
  templateDir?: string;
  /**
   * When true, fail if targetDir already exists and is non-empty. Defaults
   * to true.
   */
  refuseIfNotEmpty?: boolean;
  /** Inject a deterministic SECRETS_KEY in .env.example (for tests). */
  secretsKey?: string;
  /**
   * When true: walk up from targetDir to find a pnpm-workspace.yaml and
   * register the new package there so workspace:^ deps resolve locally.
   * The shell will install via `pnpm install` at the workspace root, NOT
   * inside its own directory.
   *
   * When false (default): the shell is written as a standalone repo. It
   * won't `pnpm install` cleanly until @business-os/* are published to a
   * registry — flag this in the success message.
   */
  workspaceMode?: boolean;
}

interface Manifest {
  tmplFiles: string[];
  verbatim: string[];
  tmplToFinal: Record<string, string>;
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

function isValidSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length >= 2 && slug.length <= 50;
}

async function isNonEmpty(dir: string): Promise<boolean> {
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return true;
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function defaultTemplateDir(): string {
  // src/index.ts lives at tools/create-client/src/, so template is two up.
  const here = dirname(fileURLToPath(import.meta.url));
  // When running from dist/, here = .../dist/. From src/ (tsx dev), here = .../src/.
  return resolve(here, '..', '..', '..', 'templates', 'client-starter');
}

function substitute(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Template references unknown placeholder {{${key}}}`);
    }
    return vars[key]!;
  });
}

export interface ScaffoldResult {
  targetDir: string;
  slug: string;
  name: string;
  /** Files written, relative to targetDir. */
  filesWritten: string[];
  /** True if a fresh SECRETS_KEY was generated. */
  generatedSecretsKey: boolean;
  /** When workspace-mode succeeded, the pnpm-workspace.yaml path + entry added. */
  workspace?: {
    yamlPath: string;
    packagesEntry: string;
    alreadyPresent: boolean;
  };
}

/**
 * Walk up from `start` looking for a directory that contains a
 * pnpm-workspace.yaml file. Returns the absolute path of that dir, or null
 * if we hit the filesystem root without finding one.
 */
async function findWorkspaceRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  for (let i = 0; i < 30; i++) {
    try {
      await stat(join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      // ignore
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Register the package directory in the workspace's pnpm-workspace.yaml by
 * appending a `  - "<relative-path>"` line to the `packages:` list.
 *
 * This is intentionally text-based rather than YAML-AST-based: pnpm-workspace.yaml
 * is small and conventionally hand-edited, and we want comments and ordering
 * preserved. We refuse to touch the file if we can't find a `packages:` key.
 */
async function registerInWorkspaceYaml(
  yamlPath: string,
  relativeEntry: string,
): Promise<{ alreadyPresent: boolean }> {
  const content = await readFile(yamlPath, 'utf8');
  const quoted = `"${relativeEntry}"`;
  const escaped = relativeEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*-\\s*"?${escaped}"?\\s*$`, 'm');
  if (re.test(content)) {
    return { alreadyPresent: true };
  }

  // Locate the `packages:` key.
  const lines = content.split('\n');
  const headerIdx = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (headerIdx === -1) {
    throw new Error(
      `pnpm-workspace.yaml at ${yamlPath} has no "packages:" key — refusing to edit. Add the entry manually:\n  - ${quoted}`,
    );
  }
  // Insert after the last existing list item under packages: (or directly after
  // the header if the list is empty).
  let insertAt = headerIdx + 1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^\s*-\s*/.test(lines[i]!) || /^\s*#/.test(lines[i]!)) {
      insertAt = i + 1;
    } else if (lines[i]!.trim() === '') {
      // blank line — keep going, may be inside packages: block
      continue;
    } else {
      break;
    }
  }
  lines.splice(insertAt, 0, `  - ${quoted}`);
  await writeFile(yamlPath, lines.join('\n'), 'utf8');
  return { alreadyPresent: false };
}

export async function scaffoldClient(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  if (!isValidSlug(opts.slug)) {
    throw new Error(
      `Invalid slug "${opts.slug}". Must match /^[a-z][a-z0-9-]*[a-z0-9]$/ (kebab-case, 2-50 chars).`,
    );
  }
  const name = opts.name ?? titleCase(opts.slug);
  const target = resolve(opts.targetDir);
  const templateDir = opts.templateDir ?? defaultTemplateDir();

  const refuse = opts.refuseIfNotEmpty ?? true;
  if (refuse && (await isNonEmpty(target))) {
    throw new Error(`Target directory ${target} is not empty (refuseIfNotEmpty=true)`);
  }

  // Load manifest.
  const manifestRaw = await readFile(join(templateDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw) as Manifest;

  // Prepare substitution vars.
  let generatedSecretsKey = false;
  let secretsKey = opts.secretsKey;
  if (!secretsKey) {
    secretsKey = Buffer.from(randomBytes(32)).toString('base64');
    generatedSecretsKey = true;
  }
  const vars: Record<string, string> = {
    CLIENT_SLUG: opts.slug,
    CLIENT_NAME: name,
    GENERATED_SECRETS_KEY: secretsKey,
  };

  await mkdir(target, { recursive: true });

  const filesWritten: string[] = [];

  // Verbatim copies (preserve directory structure).
  for (const rel of manifest.verbatim) {
    const src = join(templateDir, rel);
    const dst = join(target, rel);
    await mkdir(dirname(dst), { recursive: true });
    await cp(src, dst);
    filesWritten.push(rel);
  }

  // Template files: substitute placeholders, write under the final name.
  for (const rel of manifest.tmplFiles) {
    const finalRel = manifest.tmplToFinal[rel] ?? rel.replace(/\.tmpl$/, '');
    const src = join(templateDir, rel);
    const dst = join(target, finalRel);
    const content = await readFile(src, 'utf8');
    const subst = substitute(content, vars);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, subst, 'utf8');
    filesWritten.push(finalRel);
  }

  // Workspace-mode wire-up: find pnpm-workspace.yaml and add our entry.
  let workspaceInfo: ScaffoldResult['workspace'] | undefined;
  if (opts.workspaceMode) {
    const root = await findWorkspaceRoot(target);
    if (!root) {
      throw new Error(
        `--workspace-mode set but no pnpm-workspace.yaml found walking up from ${target}. ` +
          `Either place the scaffold inside an existing pnpm workspace tree, or omit the flag.`,
      );
    }
    const relEntry = relative(root, target).replace(/\\/g, '/');
    if (!relEntry || relEntry.startsWith('..')) {
      throw new Error(
        `--workspace-mode: target ${target} is not inside the workspace root ${root}.`,
      );
    }
    const yamlPath = join(root, 'pnpm-workspace.yaml');
    const { alreadyPresent } = await registerInWorkspaceYaml(yamlPath, relEntry);
    workspaceInfo = { yamlPath, packagesEntry: relEntry, alreadyPresent };
  }

  return {
    targetDir: target,
    slug: opts.slug,
    name,
    filesWritten,
    generatedSecretsKey,
    ...(workspaceInfo ? { workspace: workspaceInfo } : {}),
  };
}
