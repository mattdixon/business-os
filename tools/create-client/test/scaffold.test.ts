import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldClient } from '../src/index.js';

async function freshTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bos-scaffold-'));
}

describe('scaffoldClient', () => {
  it('rejects invalid slugs', async () => {
    const dir = await freshTmp();
    await expect(
      scaffoldClient({ slug: 'C-And-M-Construction', targetDir: join(dir, 'x') }),
    ).rejects.toThrow(/Invalid slug/);
    await expect(
      scaffoldClient({ slug: 'x', targetDir: join(dir, 'x') }),
    ).rejects.toThrow(/Invalid slug/);
    await expect(
      scaffoldClient({ slug: '-bad', targetDir: join(dir, 'x') }),
    ).rejects.toThrow(/Invalid slug/);
  });

  it('refuses to overwrite a non-empty target', async () => {
    const dir = await freshTmp();
    await scaffoldClient({ slug: 'first-client', targetDir: dir, refuseIfNotEmpty: false });
    await expect(
      scaffoldClient({ slug: 'first-client', targetDir: dir }),
    ).rejects.toThrow(/not empty/);
  });

  it('writes all manifest files and substitutes placeholders', async () => {
    const dir = await freshTmp();
    const result = await scaffoldClient({
      slug: 'c-and-m-construction',
      name: 'C&M Construction',
      targetDir: join(dir, 'c-and-m-construction-os'),
      secretsKey: 'TEST_KEY_FIXED',
    });
    expect(result.slug).toBe('c-and-m-construction');
    expect(result.name).toBe('C&M Construction');
    expect(result.generatedSecretsKey).toBe(false);

    // Spot-check substitutions in three different files.
    const pkg = JSON.parse(
      await readFile(join(result.targetDir, 'package.json'), 'utf8'),
    );
    expect(pkg.name).toBe('c-and-m-construction-os');

    const env = await readFile(join(result.targetDir, '.env.example'), 'utf8');
    expect(env).toContain('CLIENT_SLUG=c-and-m-construction');
    expect(env).toContain('CLIENT_NAME=C&M Construction');
    expect(env).toContain('SECRETS_KEY=TEST_KEY_FIXED');
    expect(env).toContain('c-and-m-construction_os'); // DATABASE_URL DB name

    const compose = await readFile(join(result.targetDir, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('c-and-m-construction-os-postgres');
    expect(compose).toContain('c-and-m-construction_os');

    const readme = await readFile(join(result.targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('C&M Construction');

    // No .tmpl files leak through.
    const top = await readdir(result.targetDir);
    expect(top.some((f) => f.endsWith('.tmpl'))).toBe(false);
  });

  it('generates a fresh SECRETS_KEY when not provided', async () => {
    const dir = await freshTmp();
    const result = await scaffoldClient({
      slug: 'gen-key',
      targetDir: join(dir, 'gen-key-os'),
    });
    expect(result.generatedSecretsKey).toBe(true);
    const env = await readFile(join(result.targetDir, '.env.example'), 'utf8');
    // 32 raw bytes → 44 base64 chars (with padding).
    expect(env).toMatch(/SECRETS_KEY=[A-Za-z0-9+/]{43}=/);
  });

  it('title-cases the slug when name is omitted', async () => {
    const dir = await freshTmp();
    const result = await scaffoldClient({
      slug: 'first-client',
      targetDir: join(dir, 'first-client-os'),
      secretsKey: 'x',
    });
    expect(result.name).toBe('First Client');
  });

  describe('--workspace-mode', () => {
    async function fakeWorkspace(): Promise<{ root: string; yamlPath: string }> {
      const root = await freshTmp();
      const yamlPath = join(root, 'pnpm-workspace.yaml');
      await writeFile(
        yamlPath,
        ['packages:', '  - "packages/*"', '  - "tools/*"', ''].join('\n'),
        'utf8',
      );
      await mkdir(join(root, 'clients'), { recursive: true });
      return { root, yamlPath };
    }

    it('registers the new package in pnpm-workspace.yaml', async () => {
      const { root, yamlPath } = await fakeWorkspace();
      const target = join(root, 'clients', 'c-and-m-construction-os');
      const result = await scaffoldClient({
        slug: 'c-and-m-construction',
        targetDir: target,
        secretsKey: 'x',
        workspaceMode: true,
      });
      expect(result.workspace).toBeDefined();
      expect(result.workspace!.packagesEntry).toBe('clients/c-and-m-construction-os');
      expect(result.workspace!.alreadyPresent).toBe(false);
      const yaml = await readFile(yamlPath, 'utf8');
      expect(yaml).toContain('- "clients/c-and-m-construction-os"');
      expect(yaml).toContain('- "packages/*"'); // existing entries preserved
    });

    it('does not duplicate when re-run', async () => {
      const { root, yamlPath } = await fakeWorkspace();
      const target = join(root, 'clients', 'twice');
      await scaffoldClient({
        slug: 'twice',
        targetDir: target,
        secretsKey: 'x',
        workspaceMode: true,
      });
      // Re-run with refuseIfNotEmpty=false (otherwise the empty-dir check would block).
      const result = await scaffoldClient({
        slug: 'twice',
        targetDir: target,
        secretsKey: 'x',
        workspaceMode: true,
        refuseIfNotEmpty: false,
      });
      expect(result.workspace?.alreadyPresent).toBe(true);
      const yaml = await readFile(yamlPath, 'utf8');
      const count = (yaml.match(/clients\/twice/g) ?? []).length;
      expect(count).toBe(1);
    });

    it('errors when no pnpm-workspace.yaml exists upward', async () => {
      const dir = await freshTmp();
      await expect(
        scaffoldClient({
          slug: 'orphan',
          targetDir: join(dir, 'orphan-os'),
          secretsKey: 'x',
          workspaceMode: true,
        }),
      ).rejects.toThrow(/pnpm-workspace\.yaml/);
    });

    it('errors when target is outside the workspace root', async () => {
      const { root } = await fakeWorkspace();
      const elsewhere = await freshTmp(); // a sibling of `root`, not inside it
      await expect(
        scaffoldClient({
          slug: 'outside',
          targetDir: join(elsewhere, 'outside-os'),
          secretsKey: 'x',
          workspaceMode: true,
        }),
      ).rejects.toThrow();
      void root;
    });
  });
});
