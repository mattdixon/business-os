import { describe, it, expect } from 'vitest';
import mod from '../src/server/index.js';

describe('module-example manifest', () => {
  it('declares slug + version + display name', () => {
    expect(mod.manifest.slug).toBe('example');
    expect(mod.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(mod.manifest.displayName).toBe('Example');
  });

  it('settings schema accepts an empty object (defaults applied)', () => {
    const parsed = mod.manifest.settingsSchema.parse({});
    expect(parsed.pageSize).toBe(50);
  });

  it('settings schema rejects out-of-range pageSize', () => {
    expect(() => mod.manifest.settingsSchema.parse({ pageSize: 0 })).toThrow();
    expect(() => mod.manifest.settingsSchema.parse({ pageSize: 1000 })).toThrow();
  });

  it('ships migrations + registerRoutes', () => {
    expect(mod.manifest.migrationsDir).toMatch(/migrations$/);
    expect(typeof mod.registerRoutes).toBe('function');
  });
});
