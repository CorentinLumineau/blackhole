import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readProjectIdentity, projectIdentity } from './project-identity.ts';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

describe('readProjectIdentity', () => {
  test('reads name, version, description live from package.json', () => {
    const identity = readProjectIdentity();
    expect(identity.name).toBe(pkg.name);
    expect(identity.version).toBe(pkg.version);
    expect(identity.description).toBe(pkg.description);
  });

  test('exposes homepage and repository as https URLs', () => {
    const identity = readProjectIdentity();
    expect(identity.homepage).toMatch(/^https:\/\//);
    expect(identity.repository).toMatch(/^https:\/\//);
  });

  test('exposes keywordsBase matching the current build.ts literal set', () => {
    const identity = readProjectIdentity();
    expect(identity.keywordsBase).toEqual(['native', 'workflows', 'skills']);
  });

  test('performs no filesystem writes', () => {
    const before = fs.readFileSync(path.join(root, 'package.json'), 'utf-8');
    readProjectIdentity();
    const after = fs.readFileSync(path.join(root, 'package.json'), 'utf-8');
    expect(after).toBe(before);
  });
});

describe('projectIdentity (module-level singleton)', () => {
  test('matches a fresh readProjectIdentity() call', () => {
    expect(projectIdentity).toEqual(readProjectIdentity());
  });
});

describe('readProjectIdentity in an installed plugin (no package.json)', () => {
  const makeInstall = (manifest?: object): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-install-'));
    if (manifest) {
      fs.mkdirSync(path.join(dir, '.claude-plugin'));
      fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest));
    }
    return dir;
  };

  test('falls back to the shipped .claude-plugin/plugin.json', () => {
    const dir = makeInstall({ name: 'blackhole', version: '9.9.9', description: 'installed' });
    const identity = readProjectIdentity(dir);
    expect(identity.version).toBe('9.9.9');
    expect(identity.description).toBe('installed');
    expect(identity.homepage).toMatch(/^https:\/\//);
  });

  test('does not throw when neither manifest exists', () => {
    const identity = readProjectIdentity(makeInstall());
    expect(identity.name).toBe('blackhole');
    expect(typeof identity.version).toBe('string');
  });
});
