import { describe, it, expect } from 'vitest';
import connector, { manifest } from '../src/index.js';

describe('connector-crm-stub manifest', () => {
  it('declares crm capability + none auth', () => {
    expect(manifest.slug).toBe('crm-stub');
    expect(manifest.capability).toBe('crm');
    expect(manifest.authKind).toBe('none');
  });

  it('settings schema parses an empty object', () => {
    const out = manifest.settingsSchema.parse({});
    expect(out).toEqual({});
  });

  it('connector default export carries manifest + factory', () => {
    expect(connector.manifest).toBe(manifest);
    expect(typeof connector.factory).toBe('function');
  });
});
