import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { root } from './lib/build/paths.ts';
import {
  SHADCN_COMMIT_RE,
  SHADCN_UPSTREAM_REPO,
  buildUpstreamPin,
  extractSkillFromArchiveRoot,
  listSkillFiles,
  parseCommitSha,
  readUpstreamPin,
  shouldIncludeSkillRelPath,
  tarballUrl,
  vendorPaths,
} from './sync-shadcn-skill.ts';

const PINNED = '2d3f1cd436b18ea12f24130de4df781355925b08';

describe('parseCommitSha', () => {
  test('accepts a 40-char hex SHA', () => {
    expect(parseCommitSha(PINNED)).toBe(PINNED);
  });

  test('rejects a short or non-hex value (the pin must be a commit, not a branch)', () => {
    expect(() => parseCommitSha('main')).toThrow(/40 hex/);
    expect(() => parseCommitSha('2d3f1cd')).toThrow(/40 hex/);
  });
});

describe('shouldIncludeSkillRelPath', () => {
  test('keeps SKILL.md and reference files', () => {
    expect(shouldIncludeSkillRelPath('SKILL.md')).toBe(true);
    expect(shouldIncludeSkillRelPath('cli.md')).toBe(true);
    expect(shouldIncludeSkillRelPath('rules/forms.md')).toBe(true);
  });

  test('drops the evals/ tree (upstream fixtures, not runtime)', () => {
    expect(shouldIncludeSkillRelPath('evals/evals.json')).toBe(false);
    expect(shouldIncludeSkillRelPath('evals')).toBe(false);
  });
});

describe('tarballUrl', () => {
  test('points at the GitHub archive for the pinned repo + SHA', () => {
    expect(tarballUrl(PINNED)).toBe(
      `https://github.com/${SHADCN_UPSTREAM_REPO}/archive/${PINNED}.tar.gz`
    );
  });
});

describe('buildUpstreamPin / readUpstreamPin', () => {
  test('round-trips a pin and sorts files', () => {
    const pin = buildUpstreamPin({
      commit: PINNED,
      files: ['cli.md', 'SKILL.md'],
      fetchedAt: new Date('2026-10-10T00:00:00.000Z'),
    });
    expect(pin.repo).toBe(SHADCN_UPSTREAM_REPO);
    expect(pin.files).toEqual(['SKILL.md', 'cli.md']);
    expect(SHADCN_COMMIT_RE.test(pin.commit)).toBe(true);

    const dir = makeTempDir('shadcn-pin');
    try {
      const pinPath = path.join(dir, 'upstream.json');
      fs.writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
      expect(readUpstreamPin(pinPath).commit).toBe(PINNED);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('extractSkillFromArchiveRoot', () => {
  test('copies SKILL.md + LICENSE and drops evals/', () => {
    const archive = makeTempDir('shadcn-archive');
    const dest = makeTempDir('shadcn-dest');
    try {
      fs.mkdirSync(path.join(archive, 'skills', 'shadcn', 'evals'), { recursive: true });
      fs.mkdirSync(path.join(archive, 'skills', 'shadcn', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(archive, 'LICENSE.md'), 'MIT License\n');
      fs.writeFileSync(path.join(archive, 'skills', 'shadcn', 'SKILL.md'), '# shadcn\n');
      fs.writeFileSync(path.join(archive, 'skills', 'shadcn', 'cli.md'), '# cli\n');
      fs.writeFileSync(path.join(archive, 'skills', 'shadcn', 'evals', 'evals.json'), '[]\n');
      fs.writeFileSync(path.join(archive, 'skills', 'shadcn', 'rules', 'forms.md'), '# forms\n');

      const files = extractSkillFromArchiveRoot(
        archive,
        path.join(dest, 'skill'),
        path.join(dest, 'LICENSE.md')
      );
      expect(files).toEqual(['SKILL.md', 'cli.md', 'rules/forms.md']);
      expect(fs.readFileSync(path.join(dest, 'LICENSE.md'), 'utf-8')).toBe('MIT License\n');
      expect(fs.existsSync(path.join(dest, 'skill', 'evals'))).toBe(false);
    } finally {
      fs.rmSync(archive, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  test('refuses an archive that has no SKILL.md', () => {
    const archive = makeTempDir('shadcn-bad-archive');
    const dest = makeTempDir('shadcn-bad-dest');
    try {
      fs.mkdirSync(path.join(archive, 'skills', 'shadcn'), { recursive: true });
      fs.writeFileSync(path.join(archive, 'LICENSE.md'), 'MIT\n');
      expect(() =>
        extractSkillFromArchiveRoot(archive, path.join(dest, 'skill'), path.join(dest, 'LICENSE.md'))
      ).toThrow(/SKILL\.md/);
    } finally {
      fs.rmSync(archive, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});

describe('committed vendor pin', () => {
  test('vendor/shadcn matches upstream.json (SHA, LICENSE, listed files, no evals)', () => {
    const dest = vendorPaths(root);
    const pin = readUpstreamPin(dest.pinPath);
    expect(pin.commit).toBe(PINNED);
    expect(fs.existsSync(dest.licensePath)).toBe(true);
    expect(fs.readFileSync(dest.licensePath, 'utf-8')).toContain('MIT License');
    expect(fs.existsSync(path.join(dest.skillDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dest.skillDir, 'evals'))).toBe(false);
    expect(listSkillFiles(dest.skillDir)).toEqual(pin.files);
  });
});
