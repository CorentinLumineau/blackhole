import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  appendDecisionRecords,
  findRecordsTableViolations,
  parseDecisionLogIds,
  type DecisionRecordRow,
} from './decision-log-append.ts';
import { makeTempDir } from './lib/fs.ts';
import { root } from './checks/check-utils.ts';

// Issue #717 (R-12) — decision-log-append.ts replaces the hand-append path that keeps
// forgetting to bump `last_updated` (frozen at 2026-07-20 across 6+ hand-appended rows this
// turn). Covers append/dedup/escaping (task AC) plus the digit-token dedup identity fix
// (Execution Strategy item 2): a `PR #428 / #421`-shaped existing row must be recognized as
// already covering both 428 and 421, not just the first regex match.

const FIXTURE_LOG = `---
type: reference
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-07-20
related:
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
---

# Decision Log

## Rotation

When this table exceeds 500 rows, rotate to \`_archive/\`.

## Records

| PR/Issue | Kind | Touch Paths | Decision | Why |
|---|---|---|---|---|
| PR #428 / #421 | reuse | src/references/hunt/ux-coherence.md | Reused parity.md structure | One-file-per-kind is established |
`;

const rowFor = (overrides: Partial<DecisionRecordRow> = {}): DecisionRecordRow => ({
  pr: 745,
  kind: 'approach',
  touch_paths: ['scripts/foo.ts'],
  decision: 'Did the thing',
  why: 'Because reasons',
  ...overrides,
});

describe('appendDecisionRecords', () => {
  test('appends one new record as a table row and bumps last_updated to the run date', () => {
    const { content, appended, skipped } = appendDecisionRecords(FIXTURE_LOG, [rowFor()], '2026-09-02');
    expect(appended).toBe(1);
    expect(skipped).toBe(0);
    expect(content).toContain('last_updated: 2026-09-02');
    expect(content).toContain('| 745 | approach | scripts/foo.ts | Did the thing | Because reasons |');
  });

  // Guards the dedup Set against mid-loop mutation: two records sharing one (pr, kind) key in
  // the SAME batch must not collide with each other, even with entirely different decision/why
  // text. A single worker return carrying two {pr, kind}-identical records is the routine shape,
  // so it is the fixture here.
  test('two records with the same (pr, kind) key but different text in one call both append, in order', () => {
    const worktreeDecision = rowFor({
      pr: 750,
      kind: 'approach',
      touch_paths: ['src/agents/orchestrator.md'],
      decision: 'Write into the worker\'s own worktree',
      why: 'Needs zero changes to implementer.md',
    });
    const touchPathsDecision = rowFor({
      pr: 750,
      kind: 'approach',
      touch_paths: ['scripts/decision-log-append.ts'],
      decision: 'No backtick-wrapping on touch_paths',
      why: 'Matches the documented no-transformation spec',
    });
    const { content, appended, skipped } = appendDecisionRecords(
      FIXTURE_LOG,
      [worktreeDecision, touchPathsDecision],
      '2026-09-02',
    );
    expect(appended).toBe(2);
    expect(skipped).toBe(0);
    const worktreeIdx = content.indexOf("Write into the worker's own worktree");
    const touchPathsIdx = content.indexOf('No backtick-wrapping on touch_paths');
    expect(worktreeIdx).toBeGreaterThan(-1);
    expect(touchPathsIdx).toBeGreaterThan(-1);
    expect(worktreeIdx).toBeLessThan(touchPathsIdx);
  });

  test('a second append with the same (pr, kind) pair is skipped, but last_updated still bumps and row count is unchanged', () => {
    const first = appendDecisionRecords(FIXTURE_LOG, [rowFor()], '2026-09-02');
    const second = appendDecisionRecords(first.content, [rowFor()], '2026-09-03');
    expect(second.appended).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.content).toContain('last_updated: 2026-09-03');
    const rowOccurrences = second.content.split('| 745 | approach |').length - 1;
    expect(rowOccurrences).toBe(1);
  });

  test('a `PR #428 / #421`-shaped existing row is recognized as already covering PR 421 for dedup purposes', () => {
    const { appended, skipped } = appendDecisionRecords(
      FIXTURE_LOG,
      [rowFor({ pr: 421, kind: 'reuse' })],
      '2026-09-02',
    );
    expect(appended).toBe(0);
    expect(skipped).toBe(1);
  });

  test('escapes literal | characters in decision/why/touch_paths cell text', () => {
    const { content } = appendDecisionRecords(
      FIXTURE_LOG,
      [rowFor({ decision: 'Chose A | B', why: 'A|B tradeoff', touch_paths: ['a.ts', 'b|c.ts'] })],
      '2026-09-02',
    );
    expect(content).toContain('a.ts, b\\|c.ts');
    expect(content).toContain('Chose A \\| B');
    expect(content).toContain('A\\|B tradeoff');
  });

  test('a malformed decision-log.md missing the last_updated frontmatter field fails loud', () => {
    const malformed = '# Not a real decision log\n\nNo frontmatter here.\n';
    expect(() => appendDecisionRecords(malformed, [rowFor()], '2026-09-02')).toThrow(/last_updated/);
  });
});

describe('parseDecisionLogIds', () => {
  test('collects every digit token from the PR/Issue column, including both ids in a `PR #428 / #421` cell', () => {
    const ids = parseDecisionLogIds(FIXTURE_LOG);
    expect([...ids].sort((a, b) => a - b)).toEqual([421, 428]);
  });
});

// Issue #874 — decision-log.md's Records table was pure tail-append, so every parallel PR banking
// a decision record inserted at the same anchor line and 12/15 open PRs conflicted simultaneously
// on this one file. Fix: sorted insert by the numeric PR/Issue id, the same structural technique
// #743 applied to appendIndexRowIfAbsent (scripts/lib/check-common.ts) for the INDEX.md files.
// `merge-conflict-protocol.md` § Sorted insert is the canonical write-up this comment cites
// rather than restates (V-DOC-05).

const rowsLog = (rows: { id: number; kind: DecisionRecordRow['kind']; decision: string }[]): string => `---
type: reference
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-07-20
---

# Decision Log

## Records

| PR/Issue | Kind | Touch Paths | Decision | Why |
|---|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.kind} | scripts/foo.ts | ${r.decision} | because |`).join('\n')}
`;

const idsInOrder = (content: string): number[] =>
  content
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter((cells) => cells.length >= 6 && cells[1] && cells[1].toLowerCase() !== 'pr/issue' && !/^:?-+:?$/.test(cells[1]))
    .map((cells) => Number(cells[1].match(/\d+/)?.[0]));

describe('appendDecisionRecords — sorted insert (issue #874)', () => {
  test('a new row lands between the two existing rows that bracket its id, not at the tail', () => {
    const log = rowsLog([
      { id: 10, kind: 'approach', decision: 'ten' },
      { id: 500, kind: 'approach', decision: 'five-hundred' },
      { id: 999, kind: 'approach', decision: 'nine-nine-nine' },
    ]);
    const { content } = appendDecisionRecords(log, [rowFor({ pr: 300, kind: 'approach' })], '2026-09-06');
    expect(idsInOrder(content)).toEqual([10, 300, 500, 999]);
  });

  test('no row is lost or duplicated across a sorted insert into a multi-row table', () => {
    const rows = [12, 34, 56, 78, 90].map((id) => ({ id, kind: 'approach' as const, decision: `d${id}` }));
    const log = rowsLog(rows);
    const { content } = appendDecisionRecords(log, [rowFor({ pr: 45, kind: 'approach' })], '2026-09-06');
    expect(idsInOrder(content)).toEqual([12, 34, 45, 56, 78, 90]);
    for (const r of rows) {
      expect(content.split(`d${r.id}`).length - 1).toBe(1);
    }
  });

  test('a legacy compound `PR #428 / #421`-shaped row sorts by its first digit token', () => {
    const log = `---
type: reference
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-07-20
---

# Decision Log

## Records

| PR/Issue | Kind | Touch Paths | Decision | Why |
|---|---|---|---|---|
| PR #428 / #421 | reuse | src/references/hunt/ux-coherence.md | Reused parity.md structure | One-file-per-kind is established |
`;
    const before = appendDecisionRecords(log, [rowFor({ pr: 300, kind: 'approach' })], '2026-09-06');
    expect(idsInOrder(before.content)).toEqual([300, 428]);

    const after = appendDecisionRecords(log, [rowFor({ pr: 500, kind: 'approach' })], '2026-09-06');
    expect(idsInOrder(after.content)).toEqual([428, 500]);
  });
});

// Real two-branch git construction (not just a sortedness assertion on the JS function) — the
// property that actually matters is whether `git rebase` reports CONFLICTING, which a unit test
// over appendDecisionRecords alone cannot demonstrate.
describe('appendDecisionRecords — real two-branch rebase (issue #874)', () => {
  const git = (repo: string, args: string[]) =>
    spawnSync('git', ['-C', repo, ...args], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });

  const writeAndCommit = (repo: string, content: string, message: string) => {
    fs.writeFileSync(`${repo}/decision-log.md`, content);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', message]);
  };

  // Realistic shape (matches the issue's own evidence): the campaign processes issues roughly by
  // priority, not by ascending issue number, so a wave's concurrently open PRs bank ids that fall
  // into *different gaps* of the range already recorded in the table — here #30 lands between the
  // existing 10/50 rows and #920 lands between the existing 900/950 rows, so the two branches'
  // insertions never touch the same anchor line.
  test('two branches banking decisions into different gaps of the existing range rebase without conflict', () => {
    const repo = makeTempDir('blackhole-decision-log-874-scattered');
    git(repo, ['init', '-q', '-b', 'main', '.']);
    const base = rowsLog([
      { id: 10, kind: 'approach', decision: 'base-ten' },
      { id: 50, kind: 'approach', decision: 'base-fifty' },
      { id: 900, kind: 'approach', decision: 'base-nine-hundred' },
      { id: 950, kind: 'approach', decision: 'base-nine-fifty' },
    ]);
    writeAndCommit(repo, base, 'base decision log');

    git(repo, ['checkout', '-qb', 'branch-a']);
    const a = appendDecisionRecords(base, [rowFor({ pr: 30, kind: 'approach', decision: 'A banks 30' })], '2026-09-06');
    writeAndCommit(repo, a.content, 'branch A: bank decision for #30');

    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['checkout', '-qb', 'branch-b']);
    const b = appendDecisionRecords(base, [rowFor({ pr: 920, kind: 'approach', decision: 'B banks 920' })], '2026-09-06');
    writeAndCommit(repo, b.content, 'branch B: bank decision for #920');

    // Land branch B on main first (simulating B's PR merging first), then rebase branch A onto
    // the new main — the exact sequence that produced the issue's observed conflicts.
    git(repo, ['checkout', '-q', 'main']);
    const merge = git(repo, ['merge', '--no-ff', '-q', '-m', 'merge branch B', 'branch-b']);
    expect(merge.status).toBe(0);

    git(repo, ['checkout', '-q', 'branch-a']);
    const rebase = git(repo, ['rebase', 'main']);
    expect(rebase.status).toBe(0);
    expect(fs.readFileSync(`${repo}/decision-log.md`, 'utf-8')).not.toContain('<<<<<<<');

    const finalContent = fs.readFileSync(`${repo}/decision-log.md`, 'utf-8');
    expect(finalContent).toContain('A banks 30');
    expect(finalContent).toContain('B banks 920');
    expect(idsInOrder(finalContent)).toEqual([10, 30, 50, 900, 920, 950]);

    fs.rmSync(repo, { recursive: true, force: true });
  });

  // Documented limitation (merge-conflict-protocol.md § Sorted insert): when both branches' new
  // ids exceed every id already in the table, sorted insert places both at the tail, adjacent to
  // each other — the fix cannot separate two rows that sort to the same end. This test proves the
  // limitation is real rather than asserting the fix is unconditional.
  test('two branches both banking ids past the existing max still conflict at the shared tail', () => {
    const repo = makeTempDir('blackhole-decision-log-874-tail');
    git(repo, ['init', '-q', '-b', 'main', '.']);
    const base = rowsLog([{ id: 100, kind: 'approach', decision: 'base-hundred' }]);
    writeAndCommit(repo, base, 'base decision log');

    git(repo, ['checkout', '-qb', 'branch-a']);
    const a = appendDecisionRecords(base, [rowFor({ pr: 103, kind: 'approach', decision: 'A banks 103' })], '2026-09-06');
    writeAndCommit(repo, a.content, 'branch A: bank decision for #103');

    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['checkout', '-qb', 'branch-b']);
    const b = appendDecisionRecords(base, [rowFor({ pr: 105, kind: 'approach', decision: 'B banks 105' })], '2026-09-06');
    writeAndCommit(repo, b.content, 'branch B: bank decision for #105');

    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['merge', '--no-ff', '-q', '-m', 'merge branch B', 'branch-b']);

    git(repo, ['checkout', '-q', 'branch-a']);
    const rebase = git(repo, ['rebase', 'main']);
    expect(rebase.status).not.toBe(0);
    git(repo, ['rebase', '--abort']);

    fs.rmSync(repo, { recursive: true, force: true });
  });
});

// Issue #902 fix round — CLI argv-parsing coverage (previously untested by CLI spawn). Same
// beforeEach/afterEach + makeTempDir/Bun.spawn convention as
// scripts/carry-staged-artifacts.test.ts's CLI suite.
describe('decision-log-append CLI — argv parsing', () => {
  const root = path.resolve(import.meta.dirname);
  const scriptPath = path.join(root, 'decision-log-append.ts');
  const run = (args: string[]) =>
    Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

  let dir: string;

  beforeEach(() => {
    dir = makeTempDir('decision-log-append-cli');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Regression coverage: a complete, valid required-flag set alongside one unrecognized flag
  // must still exit 2 — an unrecognized flag is malformed usage, not a value to silently drop.
  // `--log` is always pinned to a throwaway fixture here: were this test to regress to exit 0,
  // main() would proceed to write a real file, and a bare `--records-file` with no `--log`
  // would default to this repo's own live decision-log.md.
  test('a valid --records-file/--log pair plus one unrecognized flag exits 2 with usage on stderr', async () => {
    const recordsFile = path.join(dir, 'records.json');
    fs.writeFileSync(recordsFile, JSON.stringify({ decision_records: [] }));
    const logFile = path.join(dir, 'decision-log.md');
    fs.writeFileSync(logFile, FIXTURE_LOG);
    const proc = run(['--records-file', recordsFile, '--log', logFile, '--bogus-flag']);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
    expect(fs.readFileSync(logFile, 'utf-8')).toBe(FIXTURE_LOG);
  });
});

// Issue #940 — escapeCell (decision-log-append.ts:27) escapes `|` only. A cell value containing
// a real embedded newline/carriage-return (origin: a JSON string whose `\n` escape became a
// literal newline before reaching this function) was written verbatim, splitting the row across
// two physical lines and corrupting the table for every insert made afterward (findTableBlock
// treats the orphaned tail as "outside the table"). This guard rejects loudly instead.
describe('appendDecisionRecords — embedded newline/carriage-return rejection (issue #940 regression guard)', () => {
  test('throws naming the record id and field when decision contains an embedded newline', () => {
    expect(() =>
      appendDecisionRecords(FIXTURE_LOG, [rowFor({ pr: 940, decision: 'Contains a\nnewline' })], '2026-09-06'),
    ).toThrow(/940/);
    expect(() =>
      appendDecisionRecords(FIXTURE_LOG, [rowFor({ pr: 940, decision: 'Contains a\nnewline' })], '2026-09-06'),
    ).toThrow(/decision/);
  });

  test('throws naming the record id and field when why contains an embedded carriage return', () => {
    expect(() =>
      appendDecisionRecords(FIXTURE_LOG, [rowFor({ pr: 941, why: 'Contains a\rcarriage return' })], '2026-09-06'),
    ).toThrow(/941/);
    expect(() =>
      appendDecisionRecords(FIXTURE_LOG, [rowFor({ pr: 941, why: 'Contains a\rcarriage return' })], '2026-09-06'),
    ).toThrow(/why/);
  });

  test('throws when a touch_paths entry contains an embedded newline', () => {
    expect(() =>
      appendDecisionRecords(
        FIXTURE_LOG,
        [rowFor({ pr: 942, touch_paths: ['a.ts', 'b\nc.ts'] })],
        '2026-09-06',
      ),
    ).toThrow(/942/);
    expect(() =>
      appendDecisionRecords(
        FIXTURE_LOG,
        [rowFor({ pr: 942, touch_paths: ['a.ts', 'b\nc.ts'] })],
        '2026-09-06',
      ),
    ).toThrow(/touch_paths/);
  });
});

// CLI-level coverage: reproduces the issue's own reported origin — a JSON string whose `\n`
// escape sequence becomes a real newline once JSON.parse reads it back — and asserts the exit
// code specifically (not just stderr text), distinguishing this from usage()'s exit code 2.
describe('decision-log-append CLI — newline rejection (issue #940 regression guard)', () => {
  const root = path.resolve(import.meta.dirname);
  const scriptPath = path.join(root, 'decision-log-append.ts');
  const run = (args: string[]) =>
    Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

  let dir: string;

  beforeEach(() => {
    dir = makeTempDir('decision-log-append-cli-newline');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a record whose decision field contains a real embedded newline exits non-zero, non-2, and leaves the log untouched', async () => {
    const recordsFile = path.join(dir, 'records.json');
    fs.writeFileSync(
      recordsFile,
      JSON.stringify({ decision_records: [rowFor({ pr: 940, decision: 'Contains a\nnewline' })] }),
    );
    const logFile = path.join(dir, 'decision-log.md');
    fs.writeFileSync(logFile, FIXTURE_LOG);
    const proc = run(['--records-file', recordsFile, '--log', logFile]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).not.toBe(0);
    expect(code).not.toBe(2);
    expect(stderr).toContain('940');
    expect(stderr).toContain('decision');
    expect(fs.readFileSync(logFile, 'utf-8')).toBe(FIXTURE_LOG);
  });
});

// Issue #940 — permanent structural regression check. findTableBlock's blockEnd (shared with
// scripts/lib/check-common.ts, out of scope for this issue — see #941) stops at the first line
// that doesn't start with `|`, treating an orphaned continuation line as "outside the table".
// findRecordsTableViolations scans every line from the table's separator to end-of-file instead,
// so this class of corruption is caught by `bun test` rather than silently merged again.
describe('findRecordsTableViolations (issue #940 regression guard)', () => {
  test('returns no violations for a well-formed, id-sorted table', () => {
    const log = rowsLog([
      { id: 10, kind: 'approach', decision: 'ten' },
      { id: 50, kind: 'approach', decision: 'fifty' },
      { id: 999, kind: 'approach', decision: 'nine-nine-nine' },
    ]);
    expect(findRecordsTableViolations(log)).toEqual([]);
  });

  test('flags an orphaned continuation line that does not start with "| <id> |"', () => {
    const log = `---
type: reference
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-07-20
---

# Decision Log

## Records

| PR/Issue | Kind | Touch Paths | Decision | Why |
|---|---|---|---|---|
| 10 | approach | scripts/foo.ts | ten | because |
| 20 | root-cause | scripts/bar.ts | Pin sha256(title + 
 + body) as canonical | because |
| 30 | approach | scripts/baz.ts | thirty | because |
`;
    const violations = findRecordsTableViolations(log);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes('+ body) as canonical') || /line \d+/.test(v))).toBe(true);
  });

  test('flags non-monotonic ids even when every row is individually well-formed', () => {
    const log = rowsLog([
      { id: 929, kind: 'approach', decision: 'nine-two-nine' },
      { id: 885, kind: 'approach', decision: 'eight-eight-five' },
    ]);
    const violations = findRecordsTableViolations(log);
    expect(violations.length).toBeGreaterThan(0);
  });
});

// Live-file checkpoint (Task 5 of the issue #940 plan): before the repair (Task 6), this test is
// expected to FAIL, quoting the actual violations found against the corrupted file. After the
// repair it must pass, and stay the permanent regression guard going forward.
describe('documentation/reference/decision-log.md structural integrity (issue #940 regression guard)', () => {
  test('the live Records table has no structural violations', () => {
    const content = fs.readFileSync(path.join(root, 'documentation/reference/decision-log.md'), 'utf-8');
    expect(findRecordsTableViolations(content)).toEqual([]);
  });
});
