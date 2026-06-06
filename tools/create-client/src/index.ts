import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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

  return { targetDir: target, slug: opts.slug, name, filesWritten, generatedSecretsKey };
}
