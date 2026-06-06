import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
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
      scaffoldClient({ slug: 'CNN-Construction', targetDir: join(dir, 'x') }),
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
      slug: 'cnn-construction',
      name: 'CNN Construction',
      targetDir: join(dir, 'cnn-construction-os'),
      secretsKey: 'TEST_KEY_FIXED',
    });
    expect(result.slug).toBe('cnn-construction');
    expect(result.name).toBe('CNN Construction');
    expect(result.generatedSecretsKey).toBe(false);

    // Spot-check substitutions in three different files.
    const pkg = JSON.parse(
      await readFile(join(result.targetDir, 'package.json'), 'utf8'),
    );
    expect(pkg.name).toBe('cnn-construction-os');

    const env = await readFile(join(result.targetDir, '.env.example'), 'utf8');
    expect(env).toContain('CLIENT_SLUG=cnn-construction');
    expect(env).toContain('CLIENT_NAME=CNN Construction');
    expect(env).toContain('SECRETS_KEY=TEST_KEY_FIXED');
    expect(env).toContain('cnn-construction_os'); // DATABASE_URL DB name

    const compose = await readFile(join(result.targetDir, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('cnn-construction-os-postgres');
    expect(compose).toContain('cnn-construction_os');

    const readme = await readFile(join(result.targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('CNN Construction');

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
});
