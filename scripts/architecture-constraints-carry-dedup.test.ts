import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Issue #557 — the ADR-021 D2 carry-step's `append_row` idempotency guard
// (implementer.md § Carry Staged Artifacts) was documented as keying off "the row's `path`
// column value", correct for its only two prior consumers (documentation/decisions/INDEX.md,
// documentation/INDEX.md — both pipe tables). PR #556 (issue #474) adds a third `append_row`
// consumer, ARCHITECTURE.md's `## Active Constraints`, which is a bullet list with no `path`
// column: the guard as originally written could append the same constraint twice on an
// implementer re-spawn.
//
// The carry-step itself has no executable TS counterpart (it is agent-prompt prose, same as
// router.md's local-analyze mechanism — see router-local-analyze.test.ts), so this file both
// pins the spec TEXT and exercises a local reference implementation of the documented
// citation-suffix algorithm end-to-end, run twice, to prove the specified discriminator is
// actually idempotent — not merely described as such (V-TEST-05).

const root = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// --- reference implementation — mirrors implementer.md's documented ARCHITECTURE.md branch ---

// The mandatory trailing attribution planner.md appends to every constraint bullet
// (`(ADR-{NNN})` for §4.8 Trigger A, `(analyze: issue #N)` for Step 4 Trigger B) is also the
// discriminator planner.md's own near-duplicate check uses (src/agents/planner.md:41) — reused
// here rather than a second mechanism (V-INT-02).
const citationSuffix = (bulletLine: string): string | null => {
  const m = bulletLine.match(/\(([^()]+)\)\s*$/);
  return m ? `(${m[1]})` : null;
};

const activeConstraintsBullets = (architectureMd: string): string[] => {
  const section = architectureMd.split('## Active Constraints')[1] ?? '';
  const body = section.split(/\n## /)[0] ?? '';
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '));
};

// Append-only-if-absent, keyed on citation suffix — the ARCHITECTURE.md branch of the
// append_row idempotency guard implementer.md documents.
const appendConstraintBulletIfAbsent = (
  architectureMd: string,
  stagedBullet: string
): { content: string; appended: boolean } => {
  const suffix = citationSuffix(stagedBullet);
  const alreadyCarried = activeConstraintsBullets(architectureMd).some(
    (b) => citationSuffix(b) === suffix
  );
  if (alreadyCarried) return { content: architectureMd, appended: false };

  const marker = '## Active Constraints';
  const insertAt = architectureMd.indexOf(marker) + marker.length;
  const content =
    architectureMd.slice(0, insertAt) + `\n${stagedBullet}` + architectureMd.slice(insertAt);
  return { content, appended: true };
};

const FIXTURE_ARCHITECTURE = `# ARCHITECTURE

## Active Constraints
`;

describe('implementer.md — ARCHITECTURE.md append_row branch (spec text, issue #557)', () => {
  const carrySection = (() => {
    const implementer = read('src/agents/implementer.md');
    const section = implementer.split('## Carry Staged Artifacts')[1]?.split('\n## ')[0] ?? '';
    return section;
  })();

  test('Carry Staged Artifacts section exists and is non-empty', () => {
    expect(carrySection.length).toBeGreaterThan(0);
  });

  test('branches the append_row discriminator on target_path === "ARCHITECTURE.md"', () => {
    expect(carrySection).toContain('target_path === "ARCHITECTURE.md"');
    expect(carrySection).toContain('citation suffix');
  });

  test('cites both planner.md attribution suffix forms', () => {
    expect(carrySection).toMatch(/\(ADR-\{NNN\}\)/);
    expect(carrySection).toMatch(/\(analyze: issue #N\)/);
  });

  test('reuses planner.md\'s near-duplicate check rather than a second mechanism (V-INT-02)', () => {
    expect(carrySection).toContain('planner.md');
    expect(carrySection).toContain('V-INT-02');
  });

  test('the pipe-table discriminator (path column) is preserved for the two original consumers', () => {
    expect(carrySection).toContain('documentation/decisions/INDEX.md');
    expect(carrySection).toContain('documentation/INDEX.md');
    expect(carrySection).toContain("row's `path` column value");
  });
});

describe('ARCHITECTURE.md append_row citation-suffix dedup — behavior pin (issue #557)', () => {
  test('running the carry twice on the same staged bullet appends exactly once (idempotent)', () => {
    const stagedBullet = '- Never write directly to queue.json from a worker (ADR-021)';

    const first = appendConstraintBulletIfAbsent(FIXTURE_ARCHITECTURE, stagedBullet);
    expect(first.appended).toBe(true);
    expect(activeConstraintsBullets(first.content)).toHaveLength(1);

    const second = appendConstraintBulletIfAbsent(first.content, stagedBullet);
    expect(second.appended).toBe(false);
    expect(activeConstraintsBullets(second.content)).toHaveLength(1);
    // No accidental mutation on the no-op second call.
    expect(second.content).toBe(first.content);
  });

  test('a differently-cited bullet is still appended — not falsely deduped', () => {
    const first = appendConstraintBulletIfAbsent(
      FIXTURE_ARCHITECTURE,
      '- Never write directly to queue.json from a worker (ADR-021)'
    );
    const second = appendConstraintBulletIfAbsent(
      first.content,
      '- Seed Active Constraints from analyze notes at Step 4 (analyze: issue #465)'
    );
    expect(second.appended).toBe(true);
    expect(activeConstraintsBullets(second.content)).toHaveLength(2);
  });

  test('supports both attribution forms (ADR-{NNN} and analyze: issue #N) as discriminators', () => {
    expect(citationSuffix('- Some constraint (ADR-042)')).toBe('(ADR-042)');
    expect(citationSuffix('- Some other constraint (analyze: issue #12)')).toBe(
      '(analyze: issue #12)'
    );
  });
});

describe('documentation/decisions/ADR-021-durable-artifact-staging.md — Components table (issue #557)', () => {
  const adr = read('documentation/decisions/ADR-021-durable-artifact-staging.md');

  test('Components table lists planner.md §4.8 Trigger A and Step 4 Trigger B as staging producers', () => {
    expect(adr).toContain('planner.md` §4.8 Trigger A');
    expect(adr).toContain('planner.md` Step 4 Trigger B');
  });
});
