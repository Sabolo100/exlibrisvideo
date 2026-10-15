import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SHELF_DENSITY_DATASET, SHELF_DENSITY_KEY } from '@/components/views/visual/shelf-density';
import { BOOT_SCRIPT } from './boot-script';

type Stored = Record<string, string>;

/** Runs the script the way the browser does (document, localStorage, matchMedia) and returns <html>'s dataset. */
function run(storage: Stored | 'blocked', prefersDark = false): Record<string, string> {
  const dataset: Record<string, string> = {};
  const localStorage =
    storage === 'blocked'
      ? {
          getItem(): string {
            throw new Error('storage blocked');
          },
        }
      : { getItem: (key: string) => storage[key] ?? null };
  vm.runInNewContext(BOOT_SCRIPT, { document: { documentElement: { dataset } }, localStorage, matchMedia: () => ({ matches: prefersDark }) });
  return dataset;
}

describe('inline boot script (runs before the first paint)', () => {
  it('applies the saved theme: light, dark or the system preference', () => {
    expect(run({}).theme).toBe('light');
    expect(run({ exl_theme: 'dark' }).theme).toBe('dark');
    expect(run({ exl_theme: 'light' }, true).theme).toBe('light');
    expect(run({}, true).theme).toBe('dark');
    expect(run({ exl_theme: 'system' }, true).theme).toBe('dark');
  });

  it('puts a compact bookshelf density on <html>, so the ghost bookcase is as low as the real one', () => {
    const compact = run({ [SHELF_DENSITY_KEY]: JSON.stringify('compact') });
    expect(compact[SHELF_DENSITY_DATASET]).toBe('compact');
    // the dataset name renders as the attribute the CSS keys on
    expect(SHELF_DENSITY_DATASET).toBe('shelfDensity');
  });

  it('leaves the default for a comfortable, missing or malformed choice', () => {
    expect(run({ [SHELF_DENSITY_KEY]: JSON.stringify('comfortable') })[SHELF_DENSITY_DATASET]).toBeUndefined();
    expect(run({})[SHELF_DENSITY_DATASET]).toBeUndefined();
    expect(run({ [SHELF_DENSITY_KEY]: 'compact' })[SHELF_DENSITY_DATASET]).toBeUndefined(); // not JSON
    expect(run({ [SHELF_DENSITY_KEY]: JSON.stringify(42) })[SHELF_DENSITY_DATASET]).toBeUndefined();
    // a malformed density never costs the theme
    expect(run({ exl_theme: 'dark', [SHELF_DENSITY_KEY]: '{' }).theme).toBe('dark');
  });

  it('survives blocked storage (private mode, blocked site data) without throwing', () => {
    expect(() => run('blocked')).not.toThrow();
    expect(run('blocked')).toEqual({});
  });
});
