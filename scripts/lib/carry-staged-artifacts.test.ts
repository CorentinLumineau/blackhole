import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { read } from '../checks/check-utils.ts';
import { extractManifestExampleJson } from '../checks/staging-schema.check.ts';
import { withTempDir } from './test-fixtures.ts';
import {
  appendConstraintBulletIfAbsent,
  appendPipeTableRowIfAbsent,
  carryManifest,
  decideCopyMode,
  loadManifest,
  rewriteInvestigatorFrontmatter,
  validateEntries,
  type Manifest,
} from './carry-staged-artifacts.ts';
import { isCarryTargetAllowed } from './carry-target-allowlist.ts';

// Issue #715 (R-10) — mechanizes implementer.md § Carry Staged Artifacts' manifest shape guard,
// target_kind dispatch, 9-row frontmatter rewrite, and append_row dedup for both discriminator
// shapes. Every case here ports the prose's own documented behavior (`.blackhole/plans/issue-715.md`
// § Task Breakdown item 1) — no new behavior invented.

describe('loadManifest — shape guard (absent vs. zero-byte/unparseable, blackhole-state.md § Write protocol)', () => {
  test('absent manifest is a no-op — returns null, not an error', () => {
    withTempDir('carry-shape', (dir) => {
      expect(loadManifest(path.join(dir, 'manifest.json'))).toBeNull();
    });
  });

  test('zero-byte manifest throws — distinct from absent (never treated as "nothing staged")', () => {
    withTempDir('carry-shape', (dir) => {
      const manifestPath = path.join(dir, 'manifest.json');
      fs.writeFileSync(manifestPath, '');
      expect(() => loadManifest(manifestPath)).toThrow();
    });
  });

  test('unparseable manifest throws', () => {
    withTempDir('carry-shape', (dir) => {
      const manifestPath = path.join(dir, 'manifest.json');
      fs.writeFileSync(manifestPath, '{ not json');
      expect(() => loadManifest(manifestPath)).toThrow();
    });
  });

  test('a valid manifest loads', () => {
    withTempDir('carry-shape', (dir) => {
      const manifestPath = path.join(dir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify({ issue: 1, updated_at: 'x', entries: [] }));
      expect(loadManifest(manifestPath)).toEqual({ issue: 1, updated_at: 'x', entries: [] });
    });
  });
});

describe('validateEntries — per-entry field validation (malformed entries skipped, not fatal)', () => {
  const baseEntry = {
    route: 'plan',
    sub_mode: null,
    produced_by: 'planner',
    declared_at: '2026-08-06T17:58:00.000Z',
    staged_path: '.blackhole/staged/1/plan.md',
    target_path: 'documentation/plans/plan-x.md',
    target_kind: 'new_file',
  };

  test('a well-formed entry validates', () => {
    const { valid, skipped } = validateEntries([baseEntry]);
    expect(valid).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  test('a missing required field is skipped with a reason; remaining entries still process', () => {
    const malformed = { ...baseEntry, target_path: undefined };
    const { valid, skipped } = validateEntries([malformed, baseEntry]);
    expect(valid).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.index).toBe(0);
    expect(skipped[0]!.reason).toContain('target_path');
  });

  test('an invalid target_kind is skipped with a reason', () => {
    const malformed = { ...baseEntry, target_kind: 'delete_row' };
    const { valid, skipped } = validateEntries([malformed]);
    expect(valid).toHaveLength(0);
    expect(skipped[0]!.reason).toContain('target_kind');
  });

  test('sub_mode: null is a present field, not a missing one', () => {
    const { valid, skipped } = validateEntries([baseEntry]);
    expect(skipped).toHaveLength(0);
    expect(valid[0]!.sub_mode).toBeNull();
  });
});

describe('decideCopyMode — new_file per produced_by/sub_mode combination', () => {
  test('planner + plan route (sub_mode: null) → verbatim', () => {
    expect(decideCopyMode({ produced_by: 'planner', sub_mode: null })).toBe('verbatim');
  });

  test('planner + design route (sub_mode: null) → verbatim', () => {
    expect(decideCopyMode({ produced_by: 'planner', sub_mode: null })).toBe('verbatim');
  });

  test('investigator + analyze sub_mode → rewrite', () => {
    expect(decideCopyMode({ produced_by: 'investigator', sub_mode: 'analyze' })).toBe('rewrite');
  });

  test('investigator + investigate sub_mode → rewrite', () => {
    expect(decideCopyMode({ produced_by: 'investigator', sub_mode: 'investigate' })).toBe('rewrite');
  });

  test('implementer + review route → verbatim (already rendered at staging time, same default as the planner routes — issue #715 out-of-scope note: #737/#738)', () => {
    expect(decideCopyMode({ produced_by: 'implementer', sub_mode: null })).toBe('verbatim');
  });
});

describe('rewriteInvestigatorFrontmatter — the 9-row mapping table (working-note schema → doc-governance.md lifecycle schema)', () => {
  const staged = [
    '---',
    'issue: 465',
    'sub_mode: analyze',
    'confidence: 75',
    'computed_at_revision: 1',
    '---',
    '# Analysis note',
    '',
    'body content',
    '',
  ].join('\n');

  test('maps sub_mode -> type, computes status/last_updated/review_trigger, preserves declared_at date as created, passes through provenance keys, omits related/supersedes', () => {
    const out = rewriteInvestigatorFrontmatter(
      staged,
      { sub_mode: 'analyze', declared_at: '2026-08-06T17:40:00.000Z' },
      '2026-08-12',
    );
    expect(out).toContain('type: analysis');
    expect(out).toContain('status: current');
    expect(out).toContain('created: 2026-08-06');
    expect(out).toContain('last_updated: 2026-08-12');
    expect(out).toContain('review_trigger: "on file change"');
    expect(out).toContain('issue: 465');
    expect(out).toContain('confidence: 75');
    expect(out).toContain('computed_at_revision: 1');
    expect(out).not.toContain('related:');
    expect(out).not.toContain('supersedes:');
    expect(out).toContain('# Analysis note');
    expect(out).toContain('body content');
  });

  test('investigate sub_mode also maps to type: analysis (no dedicated investigation enum value)', () => {
    const out = rewriteInvestigatorFrontmatter(
      staged.replace('sub_mode: analyze', 'sub_mode: investigate'),
      { sub_mode: 'investigate', declared_at: '2026-08-06T17:40:00.000Z' },
      '2026-08-12',
    );
    expect(out).toContain('type: analysis');
  });

  test('supersedes is included only when a search-before-write target is supplied', () => {
    const out = rewriteInvestigatorFrontmatter(
      staged,
      { sub_mode: 'analyze', declared_at: '2026-08-06T17:40:00.000Z' },
      '2026-08-12',
      'documentation/audits/prior-note.md',
    );
    expect(out).toContain('supersedes: documentation/audits/prior-note.md');
  });
});

describe('append_row dedup — pipe-table discriminator (row path column value)', () => {
  const fragment =
    '| documentation/audits/analysis-issue-465.md | Evidence note | analysis | current | on file change |';
  const emptyIndex = '| path | summary | type | status | review_trigger |\n|---|---|---|---|---|\n';

  test('absent -> appended', () => {
    const result = appendPipeTableRowIfAbsent(emptyIndex, fragment);
    expect(result.appended).toBe(true);
    expect(result.content).toContain('documentation/audits/analysis-issue-465.md');
  });

  test('present -> not appended (idempotent: running the carry twice adds nothing)', () => {
    const first = appendPipeTableRowIfAbsent(emptyIndex, fragment);
    const second = appendPipeTableRowIfAbsent(first.content, fragment);
    expect(second.appended).toBe(false);
    expect(second.content).toBe(first.content);
  });
});

describe('append_row dedup — ARCHITECTURE.md bullet-list discriminator (citation suffix, issue #557)', () => {
  const architectureFixture = '# ARCHITECTURE\n\n## Active Constraints\n';
  const bullet = '- Never write directly to queue.json from a worker (ADR-021)';

  test('absent -> appended', () => {
    const result = appendConstraintBulletIfAbsent(architectureFixture, bullet);
    expect(result.appended).toBe(true);
    expect(result.content).toContain(bullet);
  });

  test('present (same citation) -> not appended (idempotent)', () => {
    const first = appendConstraintBulletIfAbsent(architectureFixture, bullet);
    const second = appendConstraintBulletIfAbsent(first.content, bullet);
    expect(second.appended).toBe(false);
    expect(second.content).toBe(first.content);
  });

  test('a differently-cited bullet is not falsely deduped', () => {
    const first = appendConstraintBulletIfAbsent(architectureFixture, bullet);
    const second = appendConstraintBulletIfAbsent(
      first.content,
      '- Seed Active Constraints from analyze notes (analyze: issue #465)',
    );
    expect(second.appended).toBe(true);
  });

  test('the "(analyze: issue #N)" attribution form is also a valid, idempotent discriminator', () => {
    const analyzeBullet = '- Some constraint (analyze: issue #12)';
    const first = appendConstraintBulletIfAbsent(architectureFixture, analyzeBullet);
    expect(first.appended).toBe(true);
    const second = appendConstraintBulletIfAbsent(first.content, analyzeBullet);
    expect(second.appended).toBe(false);
  });
});

describe('carryManifest — end-to-end against the blackhole-state.md § Staging worked example (reused fixture, not invented)', () => {
  const exampleManifest = extractManifestExampleJson(read('src/references/blackhole-state.md')) as Manifest;

  test('carries every declared entry; append_row entries are idempotent on a second run', () => {
    withTempDir('carry-e2e', (repoRoot) => {
      for (const entry of exampleManifest.entries) {
        const stagedAbs = path.join(repoRoot, entry.staged_path);
        fs.mkdirSync(path.dirname(stagedAbs), { recursive: true });
        if (entry.target_kind === 'new_file') {
          const isInvestigator = entry.produced_by === 'investigator';
          fs.writeFileSync(
            stagedAbs,
            isInvestigator
              ? '---\nissue: 465\nsub_mode: analyze\nconfidence: 75\ncomputed_at_revision: 1\n---\n# Note\n\nbody\n'
              : '---\ntype: adr\nstatus: accepted\n---\n# Doc\n\nbody\n',
          );
        } else if (entry.target_path === 'ARCHITECTURE.md') {
          fs.writeFileSync(stagedAbs, `- Constraint from issue ${exampleManifest.issue} (ADR-021)`);
        } else {
          fs.writeFileSync(
            stagedAbs,
            `| ${entry.target_path} | Staged row for issue ${exampleManifest.issue} | analysis | current | on file change |`,
          );
        }
      }
      fs.writeFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), '# ARCHITECTURE\n\n## Active Constraints\n');

      const first = carryManifest(exampleManifest, repoRoot, { today: '2026-08-12' });
      expect(first.carriedPaths).toHaveLength(exampleManifest.entries.length);
      expect(first.skippedEntries).toHaveLength(0);

      // append_row entries are the property that actually matters (a wave of implementer
      // re-spawns must never re-append the same row/bullet, per issue #715's field evidence);
      // new_file entries are re-written every run by design (verbatim copies are byte-identical;
      // the investigator rewrite only refreshes last_updated), so they are excluded here.
      const appendRowTargets = exampleManifest.entries
        .filter((e) => e.target_kind === 'append_row')
        .map((e) => e.target_path);
      const second = carryManifest(exampleManifest, repoRoot, { today: '2026-08-13' });
      for (const target of appendRowTargets) {
        expect(second.carriedPaths).not.toContain(target);
      }
      expect(second.skippedEntries).toHaveLength(0);
    });
  });
});

describe('carryManifest — two-root resolution (opts.stagingRoot, issue #760)', () => {
  const baseEntry = {
    route: 'plan',
    sub_mode: null,
    produced_by: 'planner',
    declared_at: '2026-08-06T17:58:00.000Z',
    staged_path: '.blackhole/staged/1/plan-x.md',
    target_path: 'documentation/plans/plan-x.md',
    target_kind: 'new_file' as const,
  };

  test('opts.stagingRoot, when given, resolves staged_path — target_path still resolves against repoRoot', () => {
    withTempDir('carry-staging-root', (stagingDir) => {
      withTempDir('carry-repo-root', (repoRoot) => {
        const stagedAbs = path.join(stagingDir, baseEntry.staged_path);
        fs.mkdirSync(path.dirname(stagedAbs), { recursive: true });
        fs.writeFileSync(stagedAbs, '---\ntype: plan\nstatus: current\n---\n# Plan\n');

        const manifest: Manifest = { issue: 1, updated_at: 'x', entries: [baseEntry] };
        const outcome = carryManifest(manifest, repoRoot, { stagingRoot: stagingDir });

        expect(outcome.skippedEntries).toHaveLength(0);
        expect(outcome.carriedPaths).toEqual([baseEntry.target_path]);
        expect(fs.existsSync(path.join(repoRoot, baseEntry.target_path))).toBe(true);
      });
    });
  });

  test('a declared staged_path absent under stagingRoot throws a named error citing both roots, the staged_path, and the entry index', () => {
    withTempDir('carry-staging-root', (stagingDir) => {
      withTempDir('carry-repo-root', (repoRoot) => {
        // Deliberately never write the staged file under stagingDir.
        const manifest: Manifest = { issue: 1, updated_at: 'x', entries: [baseEntry] };

        let thrown: unknown;
        try {
          carryManifest(manifest, repoRoot, { stagingRoot: stagingDir });
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        expect(message).toContain(repoRoot);
        expect(message).toContain(stagingDir);
        expect(message).toContain(baseEntry.staged_path);
        expect(message).toContain('entries[0]');
      });
    });
  });
});

describe('isCarryTargetAllowed — carry target allowlist (issue #784 AC1)', () => {
  test.each([
    ['documentation/plans/plan-x.md', true],
    ['ARCHITECTURE.md', true],
    ['package.json', false],
    ['.github/workflows/verify.yml', false],
    ['.git/hooks/pre-commit', false],
    ['scripts/foo.ts', false],
    ['src/agents/planner.md', false],
    ['.claude/settings.json', false],
    // Traversal bypass (F-00380, V-SEC-01): the allowlist tested the raw string while
    // containment tested the resolved path — a target_path could pass both by spelling its way
    // back out of `documentation/` via `..` segments. The predicate must normalize before the
    // prefix/equality test, not merely check a literal prefix.
    ['documentation/../package.json', false],
    ['documentation/../.github/workflows/verify.yml', false],
    ['documentation/./../package.json', false],
    ['documentation/../../etc/passwd', false],
    // Characterization: legitimate `..` segments that stay inside documentation/ (or resolve to
    // it) must keep carrying — normalize, don't reject `..` outright.
    ['documentation/a/../b.md', true],
    ['./documentation/x.md', true],
  ])('isCarryTargetAllowed(%s) === %s', (targetPath, expected) => {
    expect(isCarryTargetAllowed(targetPath)).toBe(expected);
  });
});

describe('carryManifest — path containment (issue #752)', () => {
  const baseEntry = {
    route: 'plan',
    sub_mode: null,
    produced_by: 'planner',
    declared_at: '2026-08-06T17:58:00.000Z',
    staged_path: '.blackhole/staged/1/plan-x.md',
    target_path: 'documentation/plans/plan-x.md',
    target_kind: 'new_file' as const,
  };

  const manifestOf = (overrides: Partial<typeof baseEntry>): Manifest => ({
    issue: 1,
    updated_at: 'x',
    entries: [{ ...baseEntry, ...overrides }],
  });

  const writeStaged = (root: string, relPath: string): void => {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '---\ntype: plan\nstatus: current\n---\n# Plan\n');
  };

  // repoRoot/stagingRoot are nested one level inside the fixture dir so a `..` escape lands
  // somewhere the fixture still owns and cleans up, rather than in the bare OS tmpdir. `.git` is
  // a real directory (clone-shaped), not the worktree's `.git` file — the shape the AC1
  // allowlist test for `.git/hooks/pre-commit` (issue #784) needs to reach a write path that
  // would have been possible pre-fix.
  const withRoots = (fn: (dir: string, repoRoot: string) => void): void =>
    withTempDir('carry-containment', (dir) => {
      const repoRoot = path.join(dir, 'repo');
      fs.mkdirSync(repoRoot);
      fs.mkdirSync(path.join(repoRoot, '.git'));
      fn(dir, repoRoot);
    });

  test('a target_path escaping repoRoot via ".." is skipped with a containment reason, and nothing is written outside repoRoot', () => {
    withRoots((dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(manifestOf({ target_path: '../escape.md' }), repoRoot);

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.index).toBe(0);
      expect(outcome.skippedEntries[0]!.reason).toContain('target_path');
      expect(outcome.skippedEntries[0]!.reason).toContain(repoRoot);
      expect(fs.existsSync(path.join(dir, 'escape.md'))).toBe(false);
    });
  });

  test('a staged_path escaping stagingRoot via ".." is skipped on containment grounds, not merely because the file is absent', () => {
    withRoots((dir, repoRoot) => {
      const stagingRoot = path.join(dir, 'staging');
      fs.mkdirSync(stagingRoot);
      // A real, readable file outside stagingRoot: the read must be refused for escaping its
      // root, which the existing absent-staged-file throw would never catch.
      fs.writeFileSync(path.join(dir, 'secret.md'), '# secret\n');

      const outcome = carryManifest(manifestOf({ staged_path: '../secret.md' }), repoRoot, { stagingRoot });

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.index).toBe(0);
      expect(outcome.skippedEntries[0]!.reason).toContain('staged_path');
      expect(outcome.skippedEntries[0]!.reason).toContain(stagingRoot);
      expect(fs.existsSync(path.join(repoRoot, baseEntry.target_path))).toBe(false);
    });
  });

  test('a lexically-contained target_path is still rejected when an intermediate directory is a symlink pointing out of repoRoot', () => {
    withRoots((dir, repoRoot) => {
      const outside = path.join(dir, 'outside');
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(repoRoot, 'documentation'));
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(manifestOf({}), repoRoot);

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.reason).toContain('target_path');
      expect(fs.existsSync(path.join(outside, 'plans', 'plan-x.md'))).toBe(false);
    });
  });

  test('an absolute-looking target_path stays contained under repoRoot but is skipped by the allowlist', () => {
    // Was a "keeps carrying" regression guard for the corrected expectation recorded in
    // `.blackhole/plans/issue-752.md` § Design Rulings: `path.join(root, '/etc/passwd')` is
    // `<root>/etc/passwd` — `path.join`, unlike `path.resolve`, does not treat a later absolute
    // segment as an anchor reset — so this input never escapes `repoRoot`, and that containment
    // property still holds unchanged. Issue #784's AC1 allowlist now supersedes it: containment
    // alone was never sufficient to make a target_path *safe to write*, which is the whole
    // premise of #784 — `/etc/passwd` is neither `documentation/**` nor `ARCHITECTURE.md`, so it
    // must be skipped, not carried.
    withRoots((_dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(manifestOf({ target_path: '/etc/passwd' }), repoRoot);

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.reason).toContain('/etc/passwd');
      expect(outcome.skippedEntries[0]!.reason).toContain('allowlist');
      expect(fs.existsSync(path.join(repoRoot, 'etc', 'passwd'))).toBe(false);
    });
  });

  test('a root-level ARCHITECTURE.md append_row target is inside repoRoot and keeps carrying', () => {
    withRoots((_dir, repoRoot) => {
      const stagedRel = '.blackhole/staged/1/architecture-active-constraint.md';
      const stagedAbs = path.join(repoRoot, stagedRel);
      fs.mkdirSync(path.dirname(stagedAbs), { recursive: true });
      fs.writeFileSync(stagedAbs, '- Never write directly to queue.json from a worker (ADR-021)');
      fs.writeFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), '# ARCHITECTURE\n\n## Active Constraints\n');

      const outcome = carryManifest(
        manifestOf({ staged_path: stagedRel, target_path: 'ARCHITECTURE.md', target_kind: 'append_row' }),
        repoRoot,
      );

      expect(outcome.skippedEntries).toEqual([]);
      expect(outcome.carriedPaths).toEqual(['ARCHITECTURE.md']);
      expect(fs.readFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), 'utf-8')).toContain('(ADR-021)');
    });
  });

  test('an escaping entry does not stop the rest of the manifest from carrying', () => {
    withRoots((dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);
      const manifest: Manifest = {
        issue: 1,
        updated_at: 'x',
        entries: [{ ...baseEntry, target_path: '../escape.md' }, { ...baseEntry }],
      };

      const outcome = carryManifest(manifest, repoRoot);

      expect(outcome.carriedPaths).toEqual([baseEntry.target_path]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.index).toBe(0);
      expect(fs.existsSync(path.join(dir, 'escape.md'))).toBe(false);
      expect(fs.existsSync(path.join(repoRoot, baseEntry.target_path))).toBe(true);
    });
  });

  test('a target_path of "package.json" is contained under repoRoot but rejected by the allowlist (issue #784 AC1)', () => {
    withRoots((_dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(manifestOf({ target_path: 'package.json' }), repoRoot);

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.reason).toContain('package.json');
      expect(outcome.skippedEntries[0]!.reason).toContain('allowlist');
      expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(false);
    });
  });

  test('a target_path of ".github/workflows/verify.yml" is contained under repoRoot but rejected by the allowlist (issue #784 AC1)', () => {
    withRoots((_dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(
        manifestOf({ target_path: '.github/workflows/verify.yml' }),
        repoRoot,
      );

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.reason).toContain('.github/workflows/verify.yml');
      expect(outcome.skippedEntries[0]!.reason).toContain('allowlist');
      expect(fs.existsSync(path.join(repoRoot, '.github', 'workflows', 'verify.yml'))).toBe(false);
    });
  });

  test('a target_path of ".git/hooks/pre-commit" under a clone-shaped repoRoot (real .git dir) is rejected by the allowlist, not merely by ENOTDIR (issue #784 AC1)', () => {
    // withRoots makes `.git` a real directory (clone shape), so pre-fix this write path was
    // reachable and would have succeeded — unlike the worktree shape (`.git` as a file), which
    // the pre-fix code already accidentally blocked via ENOTDIR. The allowlist must reject this
    // target_path outright, independent of the filesystem shape underneath it.
    withRoots((_dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(manifestOf({ target_path: '.git/hooks/pre-commit' }), repoRoot);

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.reason).toContain('.git/hooks/pre-commit');
      expect(outcome.skippedEntries[0]!.reason).toContain('allowlist');
      expect(fs.existsSync(path.join(repoRoot, '.git', 'hooks', 'pre-commit'))).toBe(false);
    });
  });

  test('a target_path of "documentation/../package.json" is skipped and a pre-existing package.json is left untouched (F-00380, V-SEC-01)', () => {
    // The traversal-bypass regression: `startsWith('documentation/')` on the raw string admits
    // this input (containment then admits it too, since path.join(repoRoot, 'documentation/../package.json')
    // genuinely resolves inside repoRoot) unless the allowlist predicate itself normalizes first.
    withRoots((_dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);
      const realPackageJson = path.join(repoRoot, 'package.json');
      fs.writeFileSync(realPackageJson, JSON.stringify({ name: 'real' }, null, 2));

      const outcome = carryManifest(manifestOf({ target_path: 'documentation/../package.json' }), repoRoot);

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.reason).toContain('documentation/../package.json');
      expect(outcome.skippedEntries[0]!.reason).toContain('allowlist');
      expect(fs.readFileSync(realPackageJson, 'utf-8')).not.toContain('PWNED');
    });
  });

  test('a target_path of "documentation/../.github/workflows/verify.yml" is skipped and no workflow file is written (F-00380, V-SEC-01)', () => {
    withRoots((_dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(
        manifestOf({ target_path: 'documentation/../.github/workflows/verify.yml' }),
        repoRoot,
      );

      expect(outcome.carriedPaths).toEqual([]);
      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.reason).toContain(
        'documentation/../.github/workflows/verify.yml',
      );
      expect(outcome.skippedEntries[0]!.reason).toContain('allowlist');
      expect(fs.existsSync(path.join(repoRoot, '.github', 'workflows', 'verify.yml'))).toBe(false);
    });
  });

  test('a target_path of "documentation/a/../b.md" (legitimate .. that stays inside documentation/) still carries — the allowlist normalizes, it does not reject all ".."', () => {
    withRoots((_dir, repoRoot) => {
      writeStaged(repoRoot, baseEntry.staged_path);

      const outcome = carryManifest(manifestOf({ target_path: 'documentation/a/../b.md' }), repoRoot);

      expect(outcome.skippedEntries).toEqual([]);
      expect(outcome.carriedPaths).toEqual(['documentation/a/../b.md']);
      expect(fs.existsSync(path.join(repoRoot, 'documentation', 'b.md'))).toBe(true);
    });
  });
});

describe('carryManifest — write-step failures are skipped, never fatal to the rest of the manifest (issue #784 AC2/AC3)', () => {
  const baseEntry = {
    route: 'plan',
    sub_mode: null,
    produced_by: 'planner',
    declared_at: '2026-08-06T17:58:00.000Z',
    staged_path: '.blackhole/staged/1/plan-x.md',
    target_path: 'documentation/x.md',
    target_kind: 'new_file' as const,
  };

  test('a documentation/ target that hits ENOTDIR (documentation pre-created as a plain file) is skipped, and an unrelated ARCHITECTURE.md entry still carries', () => {
    withTempDir('carry-write-failure', (repoRoot) => {
      // Force ENOTDIR: `documentation` exists as a plain file, so mkdirSync(recursive) for
      // `documentation/x.md`'s parent directory fails — independent of the now-allowlist-blocked
      // `.git/hooks` vector, this exercises the write-step try/catch directly (AC3).
      fs.writeFileSync(path.join(repoRoot, 'documentation'), 'not a directory');

      const failingStagedAbs = path.join(repoRoot, baseEntry.staged_path);
      fs.mkdirSync(path.dirname(failingStagedAbs), { recursive: true });
      fs.writeFileSync(failingStagedAbs, '---\ntype: plan\nstatus: current\n---\n# Plan\n');

      const architectureStagedRel = '.blackhole/staged/1/architecture-active-constraint.md';
      const architectureStagedAbs = path.join(repoRoot, architectureStagedRel);
      fs.writeFileSync(
        architectureStagedAbs,
        '- Never write directly to queue.json from a worker (ADR-021)',
      );
      fs.writeFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), '# ARCHITECTURE\n\n## Active Constraints\n');

      const manifest: Manifest = {
        issue: 1,
        updated_at: 'x',
        entries: [
          { ...baseEntry },
          {
            ...baseEntry,
            staged_path: architectureStagedRel,
            target_path: 'ARCHITECTURE.md',
            target_kind: 'append_row',
          },
        ],
      };

      const outcome = carryManifest(manifest, repoRoot);

      expect(outcome.skippedEntries).toHaveLength(1);
      expect(outcome.skippedEntries[0]!.index).toBe(0);
      expect(outcome.skippedEntries[0]!.reason).toContain('documentation/x.md');
      expect(outcome.skippedEntries[0]!.reason).toContain('write failed');
      expect(outcome.carriedPaths).toEqual(['ARCHITECTURE.md']);
      expect(fs.readFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), 'utf-8')).toContain('(ADR-021)');
    });
  });

  test('the "declared staged_path absent" case still throws — write-step try/catch does not swallow it', () => {
    withTempDir('carry-staging-root', (stagingDir) => {
      withTempDir('carry-repo-root', (repoRoot) => {
        const manifest: Manifest = { issue: 1, updated_at: 'x', entries: [baseEntry] };

        expect(() => carryManifest(manifest, repoRoot, { stagingRoot: stagingDir })).toThrow();
      });
    });
  });
});
