import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  PLUGIN_MARKETPLACE,
  checkPluginVersion,
  compareVersions,
  listCachedVersions,
  parseVersion,
  pluginVersionWarning,
  readInstalledPluginRows,
  readPluginVersionCheck,
} from './lib/plugin-drift.ts';
import { makeTempDir } from './lib/fs.ts';

describe('plugin version check', () => {
  const key = `blackhole@${PLUGIN_MARKETPLACE}`;
  const reader = (files: Record<string, string>) => (p: string) => files[p] ?? null;
  const rowsFile = (rows: unknown) => JSON.stringify({ plugins: { [key]: rows } });

  test('compareVersions compares numerically, not lexically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  test('parseVersion keeps only a leading N.N.N', () => {
    expect(parseVersion('0.30.0-rc1')).toEqual([0, 30, 0]);
    expect(parseVersion('fd30cee3ecd5')).toBeNull();
  });

  test('a newer installed_plugins.json row marks the running plugin behind', () => {
    const check = checkPluginVersion('0.28.0', [{ version: '0.29.0', source: 'installed_plugins.json' }]);
    expect(check).toMatchObject({ behind: true, newest: '0.29.0' });
    expect(check.newest_source).toContain('installed_plugins.json');
  });

  test('a newer cache directory marks the running plugin behind and names the cache', () => {
    const check = checkPluginVersion('0.28.0', [{ version: '0.29.0', source: 'plugin cache' }]);
    expect(check.behind).toBe(true);
    expect(check.newest_source).toContain('plugin cache');
  });

  test('equal, newer or unknown running versions are not behind and give no warning', () => {
    const candidates = [{ version: '0.29.0', source: 'installed_plugins.json' }];
    for (const running of ['0.29.0', '0.30.0', null]) {
      const check = checkPluginVersion(running, candidates);
      expect(check.behind).toBe(false);
      expect(pluginVersionWarning(check)).toBeNull();
    }
  });

  test('the warning is one line naming both versions, the source and the remedy', () => {
    const warning = pluginVersionWarning(checkPluginVersion('0.28.0', [{ version: '0.29.0', source: 'installed_plugins.json' }])) as string;
    expect(warning).not.toContain('\n');
    for (const part of ['0.28.0', '0.29.0', 'installed_plugins.json', '/plugin update blackhole@blackhole-marketplace']) expect(warning).toContain(part);
  });

  test('readInstalledPluginRows returns every row, including a project-scope row for another path', () => {
    const rows = [{ scope: 'user', version: '0.28.0' }, { scope: 'project', projectPath: '/elsewhere', version: '0.29.0' }];
    expect(readInstalledPluginRows(reader({ f: rowsFile(rows) }), 'f', key)).toHaveLength(2);
  });

  test('readInstalledPluginRows gives [] for an absent file, malformed JSON or a missing key', () => {
    expect(readInstalledPluginRows(reader({}), 'f', key)).toEqual([]);
    expect(readInstalledPluginRows(reader({ f: '{nope' }), 'f', key)).toEqual([]);
    expect(readInstalledPluginRows(reader({ f: JSON.stringify({ plugins: {} }) }), 'f', key)).toEqual([]);
  });

  test('listCachedVersions keeps only version-named directories', () => {
    expect(listCachedVersions('c', () => ['0.29.0', 'fd30cee3ecd5', '0.10.1'])).toEqual(['0.29.0', '0.10.1']);
  });

  test('readPluginVersionCheck is behind end to end against a temp HOME with a row and a cache dir', () => {
    const home = makeTempDir('plugin-version-home');
    try {
      const pluginsDir = path.join(home, '.claude', 'plugins');
      fs.mkdirSync(path.join(pluginsDir, 'cache', PLUGIN_MARKETPLACE, 'blackhole', '0.31.0'), { recursive: true });
      fs.mkdirSync(path.join(pluginsDir, 'cache', PLUGIN_MARKETPLACE, 'blackhole', 'fd30cee3ecd5'), { recursive: true });
      fs.writeFileSync(path.join(pluginsDir, 'installed_plugins.json'), rowsFile([{ scope: 'user', version: '0.29.0' }, { scope: 'user', version: 7 }]));
      const check = readPluginVersionCheck({ running: '0.28.0', homeDir: home, pluginName: 'blackhole' });
      expect(check).toMatchObject({ behind: true, newest: '0.31.0' });
      expect(check.newest_source).toContain('plugin cache');
      expect(readPluginVersionCheck({ running: '0.31.0', homeDir: home, pluginName: 'blackhole' }).behind).toBe(false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
