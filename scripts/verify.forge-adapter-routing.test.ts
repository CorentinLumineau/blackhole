import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { makeTempDir } from './lib/fs.ts';
import { findBareForgeCliSpawns, runChecks } from './checks/forge-adapter-routing.check.ts';

// Issue #943 — V-FORGE-01 had no test under any convention until this file. Six cases
// discriminate together: a bug that always returns `[]` fails (a)-(c); a bug that always flags
// everything fails (d)-(f). `makeTempDir` (scripts/lib/fs.ts) is the shared fixture kit
// verify.build-input-dirs.test.ts already uses for exactly this "pass real files on disk to a
// file-list-taking pure function" shape (V-INT-02).

describe('findBareForgeCliSpawns', () => {
  test('(a) a bare spawnSync("gh", ...) call is flagged, result containing "(gh)"', () => {
    const dir = makeTempDir('blackhole-forge-a');
    try {
      const file = path.join(dir, 'bare-gh.ts');
      fs.writeFileSync(file, `spawnSync('gh', ['pr', 'list']);`);
      const violations = findBareForgeCliSpawns([file]);
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain('(gh)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(b) a bare spawnSync("tea", ...) call is flagged, result containing "(tea)"', () => {
    const dir = makeTempDir('blackhole-forge-b');
    try {
      const file = path.join(dir, 'bare-tea.ts');
      fs.writeFileSync(file, `spawnSync('tea', ['pr', 'list']);`);
      const violations = findBareForgeCliSpawns([file]);
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain('(tea)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(c) a bare spawnSync("glab", ...) call is flagged, result containing "(glab)"', () => {
    const dir = makeTempDir('blackhole-forge-c');
    try {
      const file = path.join(dir, 'bare-glab.ts');
      fs.writeFileSync(file, `spawnSync('glab', ['mr', 'list']);`);
      const violations = findBareForgeCliSpawns([file]);
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain('(glab)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(d) a file with no forge-CLI spawn at all returns []', () => {
    const dir = makeTempDir('blackhole-forge-d');
    try {
      const file = path.join(dir, 'no-spawn.ts');
      fs.writeFileSync(file, `console.log('nothing to see here');`);
      expect(findBareForgeCliSpawns([file])).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(e) a file calling a different CLI (spawnSync("git", ...)) is not flagged — regex is CLI-name-specific', () => {
    const dir = makeTempDir('blackhole-forge-e');
    try {
      const file = path.join(dir, 'git-spawn.ts');
      fs.writeFileSync(file, `spawnSync('git', ['status']);`);
      expect(findBareForgeCliSpawns([file])).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(f) the real allowlisted scripts/lib/forge-adapter/cli.ts is not flagged despite containing a literal spawnSync("gh", ...) call', () => {
    const allowlisted = path.join(root, 'scripts/lib/forge-adapter/cli.ts');
    expect(fs.readFileSync(allowlisted, 'utf-8')).toContain(`spawnSync('gh'`);
    expect(findBareForgeCliSpawns([allowlisted])).toEqual([]);
  });
});

describe('runChecks live tree (V-FORGE-01)', () => {
  test('passes against the live repo with no violations', () => {
    const results = runChecks();
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('V-FORGE-01');
    expect(results[0].ok).toBe(true);
    expect(results[0].detail).toBeUndefined();
  });
});
