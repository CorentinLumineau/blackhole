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

// BARE_PARSE_RE matches raw text, so a `//` comment or a string literal that merely contains the
// flagged token sequence would otherwise produce a false BLOCK on a green tree. This walks a
// single line's characters, tracking string state (with backslash-escape handling) and comment
// state, and emits only the code portion — the flagged shape can then only match a genuine call
// expression. Accepted, stated gaps: no cross-line tracking of an unterminated `/* ...` block
// comment (it is truncated to end-of-line, not carried into the next line), and no resolution of
// `${...}` template-literal interpolation — both already sit outside this check's pre-existing
// line-by-line design, so this scrubber does not add new debt on top of it.
export const stripCommentsAndStrings = (line: string): string => {
  let out = '';
  let inString: '"' | "'" | '`' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (inString) {
      if (ch === '\\') {
        i++; // skip the escaped character — it can never end the string early
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '/' && next === '/') break; // line comment — rest of the line is not code
    if (ch === '/' && next === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close === -1) break; // unterminated on this line — treated as running to end-of-line
      i = close + 1;
      continue;
    }
    out += ch;
  }
  return out;
};

// Splits `content` into lines and flags every line matching the bare-parse shape, returning
// `label:lineNumber` locations — same per-line scan shape as `findBareJqEmptyPrescriptions`.
export const findBareJsonParseBypasses = (content: string, label: string): string[] => {
  const lines = content.split('\n');
  const violations: string[] = [];
  lines.forEach((line, idx) => {
    if (BARE_PARSE_RE.test(stripCommentsAndStrings(line))) violations.push(`${label}:${idx + 1}`);
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
