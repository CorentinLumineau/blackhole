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
});
