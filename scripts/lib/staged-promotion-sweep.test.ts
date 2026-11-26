import { describe, expect, test } from 'bun:test';
import { sweepStaged, type SweepInput } from './staged-promotion-sweep.ts';

const entry = (target_path: string, staged_path = '.blackhole/staged/7/a.md') => ({
  route: 'plan',
  sub_mode: null,
  produced_by: 'planner',
  declared_at: '2026-01-01T00:00:00.000Z',
  staged_path,
  target_path,
  target_kind: 'new_file',
});

const base = (over: Partial<SweepInput>): SweepInput => ({
  manifests: [],
  queue: { '7': { status: 'merged' } },
  targetExists: () => false,
  stagedPathExists: () => true,
  ...over,
});

const stateOf = (input: SweepInput): string[] => sweepStaged(input).map((r) => r.state);

describe('sweepStaged', () => {
  test('carried: target present on the ref', () => {
    const rows = sweepStaged(base({ manifests: [{ issue: 7, manifest: { entries: [entry('documentation/plans/p.md')] } }], targetExists: () => true }));
    expect(rows).toEqual([
      { issue: 7, issue_status: 'merged', entry_index: 0, target_path: 'documentation/plans/p.md', state: 'carried' },
    ]);
  });

  test('unpromoted_merged: merged issue, target absent on the ref', () => {
    expect(stateOf(base({ manifests: [{ issue: 7, manifest: { entries: [entry('documentation/plans/p.md')] } }] }))).toEqual(['unpromoted_merged']);
  });

  test('pending_open_issue: issue still open', () => {
    const input = base({ queue: { '7': { status: 'in-flight' } }, manifests: [{ issue: 7, manifest: { entries: [entry('documentation/plans/p.md')] } }] });
    expect(stateOf(input)).toEqual(['pending_open_issue']);
  });

  test('an issue absent from the queue is treated as open, never as merged', () => {
    const input = base({ queue: {}, manifests: [{ issue: 7, manifest: { entries: [entry('documentation/plans/p.md')] } }] });
    expect(sweepStaged(input)[0]).toMatchObject({ state: 'pending_open_issue', issue_status: null });
  });

  test('target_outside_allowlist: package tree without a package root', () => {
    const input = base({ manifests: [{ issue: 7, manifest: { entries: [entry('services/p/documentation/plans/x.md')] } }] });
    expect(stateOf(input)).toEqual(['target_outside_allowlist']);
  });

  test('package-scoped target is judged by the package root when given', () => {
    const input = base({
      packageRoot: 'services/p',
      manifests: [{ issue: 7, manifest: { entries: [entry('services/p/documentation/plans/x.md')] } }],
    });
    expect(stateOf(input)).toEqual(['unpromoted_merged']);
  });

  test('staged_path_missing: neither carried nor recoverable', () => {
    const input = base({ stagedPathExists: () => false, manifests: [{ issue: 7, manifest: { entries: [entry('documentation/plans/p.md')] } }] });
    expect(stateOf(input)).toEqual(['staged_path_missing']);
  });

  test('legacy_manifest_shape: a bare array is flagged, not thrown on', () => {
    const rows = sweepStaged(base({ manifests: [{ issue: 7, manifest: [entry('documentation/plans/p.md')] }] }));
    expect(rows).toEqual([
      { issue: 7, issue_status: 'merged', entry_index: -1, target_path: null, state: 'legacy_manifest_shape' },
    ]);
  });

  test('manifest_unreadable: null (parse failure) and an object without entries', () => {
    expect(stateOf(base({ manifests: [{ issue: 7, manifest: null }] }))).toEqual(['manifest_unreadable']);
    expect(stateOf(base({ manifests: [{ issue: 7, manifest: { issue: 7 } }] }))).toEqual(['manifest_unreadable']);
  });

  test('a malformed entry is its own manifest_unreadable row and does not hide siblings', () => {
    const input = base({ manifests: [{ issue: 7, manifest: { entries: [{ nope: 1 }, entry('documentation/plans/p.md')] } }] });
    expect(sweepStaged(input).map((r) => [r.entry_index, r.state])).toEqual([
      [0, 'manifest_unreadable'],
      [1, 'unpromoted_merged'],
    ]);
  });

  test('the target-presence probe is not called for an entry outside the allowlist', () => {
    const probed: string[] = [];
    sweepStaged(base({ targetExists: (p) => (probed.push(p), false), manifests: [{ issue: 7, manifest: { entries: [entry('package.json')] } }] }));
    expect(probed).toEqual([]);
  });

  describe('append_row entries', () => {
    const HEADER = '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n';
    const ROW_A = '| ADR-001-a.md | A | adr | accepted | on ADR acceptance |';
    const ROW_B = '| ADR-002-b.md | B | adr | accepted | on ADR acceptance |';
    const BULLET = '- Keep the sweep honest (ADR-099)';
    const rowEntry = (target_path: string) => ({ ...entry(target_path), target_kind: 'append_row' });
    const run = (target: string, targetContent: string | null, staged: string | null, status = 'merged') =>
      stateOf(
        base({
          queue: { '7': { status } },
          targetExists: () => targetContent !== null,
          readTarget: () => targetContent,
          readStaged: () => staged,
          manifests: [{ issue: 7, manifest: { entries: [rowEntry(target)] } }],
        }),
      );
    const DEC = 'documentation/decisions/INDEX.md';

    test('decisions INDEX present but lacking the staged row is unpromoted_merged, not carried', () => {
      expect(run(DEC, `${HEADER}${ROW_A}\n`, ROW_B)).toEqual(['unpromoted_merged']);
    });

    test('decisions INDEX already holding the staged row is carried', () => {
      expect(run(DEC, `${HEADER}${ROW_A}\n${ROW_B}\n`, ROW_B)).toEqual(['carried']);
    });

    test('ARCHITECTURE.md without the citation suffix is unpromoted_merged; with it, carried', () => {
      const arch = (b: string) => `# Arch\n\n## Active Constraints\n${b}\n`;
      expect(run('ARCHITECTURE.md', arch('- Other rule (ADR-001)'), BULLET)).toEqual(['unpromoted_merged']);
      expect(run('ARCHITECTURE.md', arch(BULLET), BULLET)).toEqual(['carried']);
    });

    test('an open issue with the row absent is pending_open_issue', () => {
      expect(run(DEC, `${HEADER}${ROW_A}\n`, ROW_B, 'in-flight')).toEqual(['pending_open_issue']);
    });

    test('the retired root documentation/INDEX.md append_row stays carried when the target exists', () => {
      expect(run('documentation/INDEX.md', `${HEADER}${ROW_A}\n`, ROW_B)).toEqual(['carried']);
    });

    test('target present but staged fragment unreadable is staged_path_missing, never carried', () => {
      expect(run(DEC, `${HEADER}${ROW_A}\n`, null)).toEqual(['staged_path_missing']);
    });

    test('a fragment failing the shape check is not carried and does not throw', () => {
      expect(run(DEC, `${HEADER}${ROW_A}\n`, '| only | two |')).toEqual(['unpromoted_merged']);
    });

    test('a new_file entry is still judged by target existence alone', () => {
      const input = base({ targetExists: () => true, readTarget: () => 'x', readStaged: () => null, manifests: [{ issue: 7, manifest: { entries: [entry('documentation/plans/p.md')] } }] });
      expect(stateOf(input)).toEqual(['carried']);
    });
  });
});
