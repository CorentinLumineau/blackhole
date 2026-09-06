import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { walkFilesAbs } from '../lib/fs.ts';

// Issue #867 (leg 1) — V-JSONREAD-01: pins the class, not just the instance. Every bare
// parse-of-a-synchronous-file-read across `scripts/**` (an inline `JSON.parse` wrapped directly
// around an `fs.readFileSync`/`readFileSync` call, un-namespaced import included) bypasses
// `scripts/lib/fs.ts`'s declared shared helper `readJsonFile` (V-INT-02) — a future hardening of
// that one helper (e.g. a zero-byte guard) would reach every migrated call site for free, while a
// bypass site would need the same fix applied a second time. Same "pin the class" shape as
// `jq-empty-guard.check.ts` (issue #558). NOTE: this comment deliberately avoids spelling out the
// literal matched token sequence — doing so would make this file flag itself.
const BARE_PARSE_RE = /JSON\.parse\(\s*(?:fs\.)?readFileSync\(/;

const scriptsDir = path.join(root, 'scripts');

// scripts/lib/fs.ts is the SSOT definition of readJsonFile itself — its own body (and doc
// comment describing the pattern it replaces) legitimately contains the bare-parse shape and
// must not flag itself. `*.test.ts` files are excluded the same way `vocabulary.check.ts`'s
// `scanScriptsTs` excludes them: unit-test fixtures may contain the flagged pattern as a
// synthetic string for their own coverage, not as a real call site.
const EXEMPT_REL_PATH = 'scripts/lib/fs.ts';

// Splits `content` into lines and flags every line matching the bare-parse shape, returning
// `label:lineNumber` locations — same per-line scan shape as `findBareJqEmptyPrescriptions`.
export const findBareJsonParseBypasses = (content: string, label: string): string[] => {
  const lines = content.split('\n');
  const violations: string[] = [];
  lines.forEach((line, idx) => {
    if (BARE_PARSE_RE.test(line)) violations.push(`${label}:${idx + 1}`);
  });
  return violations;
};

const checkReadJsonFile = (): CheckResult => {
  const violations = walkFilesAbs(scriptsDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .filter((rel) => rel !== EXEMPT_REL_PATH)
    .flatMap((rel) => findBareJsonParseBypasses(fs.readFileSync(path.join(root, rel), 'utf-8'), rel));
  if (violations.length) return { id: 'V-JSONREAD-01', ok: false, detail: violations.join('; ') };
  return { id: 'V-JSONREAD-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkReadJsonFile()];
