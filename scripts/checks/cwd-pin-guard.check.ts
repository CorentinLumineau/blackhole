import { listFiles } from '../lib/check-common.ts';
import { read, type CheckResult } from './check-utils.ts';

// Issue #798 — cwd-pin-guard.check.ts: matches verify.cwd-pin-guard.test.ts.
// `bun run scripts/<name>.ts` resolves the entry file and every transitive relative `./lib/...`
// import against the process cwd, not against any `--repo-root`/`--config`/`--ledger` argument
// value — so a documented invocation of one of the three scripts below that omits `--cwd` risks
// silently running stale/divergent library code when cwd and --repo-root point at different
// trees (concrete incident: PR #790 / issue #743, traced in
// `.blackhole/plans/issue-798-investigation.md`). Every documented invocation is pinned via
// `bun run --cwd <target-root> scripts/<name>.ts ...` (`--cwd` immediately after `bun run`,
// before the script path) — this check pins the class, not just the three sites fixed for #798.

const TARGET_SCRIPTS = [
  'scripts/check-review-artifact.ts',
  'scripts/carry-staged-artifacts.ts',
  'scripts/lib/companion-file-sync.ts',
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Optional `--cwd <value>` clause immediately after `bun run`. `<value>` may be a single
// non-space token, or a `<...>`/`` `...` ``-bracketed placeholder that itself contains spaces
// (e.g. `<abs repo-root>`, `<this worktree's absolute path>`) — a plain `\S+` cannot span those.
const CWD_CLAUSE = String.raw`(?:--cwd\s+(?:<[^>]*>|\`[^\`]*\`|\S+)\s+)?`;

// A real invocation requires the (optional) `--cwd` clause to sit directly between `bun run`
// and the script path — nothing else. This is what keeps a prose mention (e.g. this check's own
// V-CWDPIN-01 table row, "bun run invocation of check-review-artifact.ts, ... or
// scripts/lib/companion-file-sync.ts") from matching: the words between "bun run" and the
// script literal there aren't a `--cwd` clause, so the regex never anchors on that line at all.
const invocationRegex = (script: string): RegExp =>
  new RegExp(`bun run\\s+(${CWD_CLAUSE})${escapeRegExp(script)}\\b`);

// Scans `content` line-by-line for a `bun run scripts/<one of TARGET_SCRIPTS>` invocation and
// flags any line whose captured clause is empty — i.e. `--cwd` is not the token immediately
// following `bun run`, before the script path.
export const findMissingCwdPin = (content: string, label: string): string[] => {
  const lines = content.split('\n');
  const violations: string[] = [];
  lines.forEach((line, idx) => {
    for (const script of TARGET_SCRIPTS) {
      const match = invocationRegex(script).exec(line);
      if (match && match[1] === '') violations.push(`${label}:${idx + 1}`);
    }
  });
  return violations;
};

// Sweep scope: `src/agents/*.md` + `src/references/*.md` (non-recursive) plus the root
// `src/SKILL.md`, which documents its own bootstrap-time invocation and so carries the same
// class of call site. `src/references/hunt/*.md` stays deliberately excluded (not exempted from
// an otherwise-matching pattern): it sits outside the declared sweep path.
const SWEEP_DIRS = ['src/agents', 'src/references'];
const SWEEP_FILES = ['src/SKILL.md'];

// Exported so the sweep's own scope is assertable, not just its verdict: a scope that silently
// stops covering a file would otherwise still report `ok: true`.
export const sweepTargets = (): string[] => [
  ...SWEEP_DIRS.flatMap((dir) => listFiles(dir).map((file) => `${dir}/${file}`)),
  ...SWEEP_FILES,
];

const checkCwdPinGuard = (): CheckResult => {
  const violations = sweepTargets().flatMap((target) => findMissingCwdPin(read(target), target));
  if (violations.length) return { id: 'V-CWDPIN-01', ok: false, detail: violations.join('; ') };
  return { id: 'V-CWDPIN-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkCwdPinGuard()];
