import { describe, expect, test } from 'bun:test';
import { findHeredocDocWrites, runChecks } from './checks/prose-heredoc.check.ts';

// A step whose output is a pure function of files/JSON belongs in a `scripts/<name>.ts`
// invocation, not agent prose (ADR-003) — this is the mechanical enforcement that a literal
// fenced `cat <<` heredoc doc-write never sneaks back into agent prose.

describe('findHeredocDocWrites', () => {
  test('same-line cat <<EOF > documentation/foo.md inside a fence flags the cat << line', () => {
    const md = [
      '```bash',
      "cat <<'EOF' > documentation/foo.md",
      'body content',
      'EOF',
      '```',
    ].join('\n');
    expect(findHeredocDocWrites(md)).toEqual([2]);
  });

  test('cat << to /tmp then later mv to .blackhole/staged/ inside one fence flags the cat << line', () => {
    const md = [
      '```bash',
      "cat <<'EOF' > /tmp/x.md",
      'body content',
      'EOF',
      'mv /tmp/x.md .blackhole/staged/1/foo.md',
      '```',
    ].join('\n');
    expect(findHeredocDocWrites(md)).toEqual([2]);
  });

  test('heredoc redirected only to a non-flagged path (no later mv to a flagged prefix) is 0 hits', () => {
    const md = [
      '```bash',
      "cat <<'EOF' > /tmp/scratch.md",
      'body content',
      'EOF',
      '```',
    ].join('\n');
    expect(findHeredocDocWrites(md)).toEqual([]);
  });

  test('heredoc body prose containing "documentation/" with redirect targeting /tmp/ only is 0 hits (redirect-line scoping)', () => {
    const md = [
      '```bash',
      "cat <<'EOF' > /tmp/report.md",
      'See documentation/foo.md for details.',
      'EOF',
      '```',
    ].join('\n');
    expect(findHeredocDocWrites(md)).toEqual([]);
  });

  test('cat << and documentation/ co-occurring only in plain prose outside any fence is 0 hits (fence scoping)', () => {
    const md = [
      'Use a Bash heredoc + atomic `mv` (e.g. `cat <<EOF` writing under `documentation/`) as the mechanism description.',
    ].join('\n');
    expect(findHeredocDocWrites(md)).toEqual([]);
  });
});

describe('prose-heredoc runChecks() live tree', () => {
  test('returns one CheckResult entry', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results.map((r) => r.id)).toEqual(['V-PROSE-01']);
  });

  test('issue-718: zero live findings after R-10 removed the last fenced heredoc doc-write', () => {
    const result = runChecks().find((r) => r.id === 'V-PROSE-01');
    expect(result!.ok).toBe(true);
  });
});
