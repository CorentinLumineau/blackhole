import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decide, gitIo } from './slop-citation-check.mjs';

const DIR = import.meta.dir;
const { templates, vectors } = JSON.parse(readFileSync(path.join(DIR, 'fixtures', 'slop-citation-vectors.json'), 'utf8'));

let repo = '';
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });
const content = (v: string) => (v.startsWith('@tpl:') ? templates[v.slice(5)] : v);
const writeAll = (files: Record<string, string> = {}) => {
  for (const [p, v] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, p)), { recursive: true });
    writeFileSync(path.join(repo, p), content(v));
  }
};
const commitAll = (msg: string) => {
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', msg);
};

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'bh-slop-cite-'));
  git('init', '-q', '-b', 'main');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('vendored slop-citation-check', () => {
  test('body matches the sha256 in its vendor header (re-vendor, never hand-edit)', () => {
    const [header, ...body] = readFileSync(path.join(DIR, 'slop-citation-check.mjs'), 'utf8').split('\n');
    const want = header.match(/body-sha256=([0-9a-f]{64})/)?.[1];
    expect(want).toBeDefined();
    expect(createHash('sha256').update(body.join('\n')).digest('hex')).toBe(want);
  });

  for (const v of vectors) {
    test(`vector: ${v.name}`, () => {
      writeAll(v.base);
      commitAll('base');
      git('checkout', '-q', '-b', 'feature');
      for (const [from, to] of v.renames ?? []) {
        mkdirSync(path.dirname(path.join(repo, to)), { recursive: true });
        git('mv', from, to);
      }
      writeAll(v.head);
      commitAll('head');
      if (v.baseAfter) {
        git('checkout', '-q', 'main');
        writeAll(v.baseAfter);
        commitAll('base tip');
        git('checkout', '-q', 'feature');
      }
      const result = decide(v.citation, gitIo({ base: 'main', head: 'HEAD', cwd: repo }));
      expect(result.verdict === 'VERIFIED' ? { exit: 0 } : { exit: 1, reason: result.reason }).toEqual(v.expect);
    });
  }
});
