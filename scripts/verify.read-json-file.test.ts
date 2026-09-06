import { describe, expect, test } from 'bun:test';
import { findBareJsonParseBypasses, runChecks } from './checks/read-json-file.check.ts';

// Regression guard for issue #867 (leg 1): every bare `JSON.parse(fs.readFileSync(...))` call
// site across `scripts/**` bypasses `scripts/lib/fs.ts`'s shared `readJsonFile` helper
// (V-INT-02) — this pins the class, not just the 16 instances migrated in this same PR.

describe('findBareJsonParseBypasses', () => {
  test('flags a bare JSON.parse(fs.readFileSync(...)) call at its line', () => {
    const bad = [
      'const load = (p: string) => {',
      "  return JSON.parse(fs.readFileSync(p, 'utf-8'));",
      '};',
    ].join('\n');
    expect(findBareJsonParseBypasses(bad, 'fixture.ts')).toEqual(['fixture.ts:2']);
  });

  test('does not flag a call using readJsonFile instead', () => {
    const good = "const load = (p: string) => readJsonFile(p, p);";
    expect(findBareJsonParseBypasses(good, 'fixture.ts')).toEqual([]);
  });

  // Covers stripCommentsAndStrings's comment-truncation branch.
  test('does not flag a bare-parse token sequence inside a // comment', () => {
    const commented = [
      'const load = (p: string) => {',
      "  // JSON.parse(fs.readFileSync(p, 'utf-8')) — do not do this, use readJsonFile",
      '};',
    ].join('\n');
    expect(findBareJsonParseBypasses(commented, 'fixture.ts')).toEqual([]);
  });

  test('does not flag a bare-parse token sequence inside a string literal', () => {
    const stringLiteral = [
      'const load = (p: string) => {',
      '  const example = "JSON.parse(fs.readFileSync(p, \'utf-8\'))";',
      '};',
    ].join('\n');
    expect(findBareJsonParseBypasses(stringLiteral, 'fixture.ts')).toEqual([]);
  });
});

describe('read-json-file runChecks() against the real scripts/ tree', () => {
  test('exempts *.test.ts fixtures from the scan', () => {
    // A synthetic fixture ending .test.ts is never walked by the real check (it is filtered out
    // by the `!f.endsWith('.test.ts')` predicate before findBareJsonParseBypasses ever sees it)
    // — this file's own fixture strings above prove that in practice: this very file matches the
    // bare-parse shape verbatim (see the 'bad' fixture) yet the live-tree run below reports zero
    // violations attributed to `scripts/verify.read-json-file.test.ts`.
    const results = runChecks();
    const [result] = results;
    expect(result.detail ?? '').not.toContain('verify.read-json-file.test.ts');
  });

  test('exempts scripts/lib/fs.ts itself (the SSOT definition)', () => {
    const results = runChecks();
    const [result] = results;
    expect(result.detail ?? '').not.toContain('scripts/lib/fs.ts:');
  });

  test('returns exactly one V-JSONREAD-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-JSONREAD-01');
  });

  // Task 2 red-before-green: at this point in the task sequence (before Tasks 3-5 migrate any
  // of the 13 files), the live tree must report exactly the 16 known bypass sites enumerated in
  // the plan's Severity classification section. This assertion is EXPECTED TO FAIL once the
  // migration lands (Tasks 3-5) — that is the whole point: it proves the detector reproduces the
  // known-bad state before the fix, so a check with no real detection logic could not pass it
  // (V-UNFALSIFIABLE-01). Once all 16 sites are migrated, `ok` flips to `true` (see the final
  // 'passes against the fully migrated tree' test below, which is the green counterpart).
  test('passes against the fully migrated tree (post Tasks 3-5)', () => {
    const [result] = runChecks();
    // On failure, surface which file:line still bypasses readJsonFile rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});
