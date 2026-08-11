import * as fs from 'fs';
import * as path from 'path';
import { walkMdFilesAbs } from '../lib/check-common.ts';
import { root, type CheckResult } from './check-utils.ts';

// Issue #558 — jq-empty-guard.check.ts: matches verify.jq-empty-guard.test.ts.
// Pins the class, not just the instance: `jq empty` has been hand-fixed three times (#536,
// #546, #553) with nothing stopping a fourth reintroduction. Flags any `src/` file that
// prescribes bare `jq empty` as a sufficient guard, without flagging a mention that correctly
// warns against it (`blackhole-state.md` § Write protocol is the canonical explanation of why
// it's insufficient — every other mention across `src/` references or restates that warning).

const JQ_EMPTY_RE = /jq\s+empty/i;
const NEGATION_RE = /\b(never|cannot|can't|insufficient|not\s+sufficient)\b/i;

// The smallest radius that passes every one of the 13 currently-correct mentions in `src/` — 12
// carry their negation word on the same line, and blackhole-state.md's exception sits 4 lines
// from its "never sufficient" anchor. Do not widen without re-auditing every mention first.
const WINDOW_RADIUS = 5;

// Splits `content` into lines and flags every `jq empty` mention whose ±WINDOW_RADIUS-line
// window contains no negation word — i.e. a mention prescribing it as sufficient on its own.
export const findBareJqEmptyPrescriptions = (content: string, label: string): string[] => {
  const lines = content.split('\n');
  const violations: string[] = [];
  lines.forEach((line, idx) => {
    if (!JQ_EMPTY_RE.test(line)) return;
    const start = Math.max(0, idx - WINDOW_RADIUS);
    const end = Math.min(lines.length, idx + WINDOW_RADIUS + 1);
    if (!NEGATION_RE.test(lines.slice(start, end).join('\n'))) violations.push(`${label}:${idx + 1}`);
  });
  return violations;
};

const checkJqEmptyGuard = (): CheckResult => {
  const violations = walkMdFilesAbs(path.join(root, 'src')).flatMap((abs) =>
    findBareJqEmptyPrescriptions(fs.readFileSync(abs, 'utf-8'), path.relative(root, abs).split(path.sep).join('/')),
  );
  if (violations.length) return { id: 'V-JQEMPTY-01', ok: false, detail: violations.join('; ') };
  return { id: 'V-JQEMPTY-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkJqEmptyGuard()];
