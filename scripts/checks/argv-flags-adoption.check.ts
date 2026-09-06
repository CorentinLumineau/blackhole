import { read, type CheckResult } from './check-utils.ts';

// A permanent regression guard, not a one-time migration check: the closed allowlist below names
// exactly the 15 scripts/** CLI entrypoints migrated onto scripts/lib/argv-flags.ts's shared
// parseFlags/requireFlag pair (each previously hand-rolled its own ~10-line argv loop —
// V-INT-02/V-DRY-01). Deliberately excludes scripts/stack-repair.ts (the seed, not migrated in
// the same PR that introduced this module — a disclosed, out-of-scope duplicate) and
// scripts/lib/campaign-status/cli.ts's parseStatusArgs (subcommand dispatch, a different concern
// from flag/value pairs — never a variant of this one). An open scripts/** regex detector was
// rejected: the target shape ("a loop comparing `arg === '--x'`") is a common code shape and
// would inherit and worsen the raw-text false-positive class an unrelated detector already hit —
// this file is a closed presence-only allowlist instead (style precedent:
// scripts/checks/cwd-pin-guard.check.ts's TARGET_SCRIPTS).
const TARGET_SCRIPTS = [
  'scripts/campaign-resume-signal.ts',
  'scripts/carry-staged-artifacts.ts',
  'scripts/check-review-artifact.ts',
  'scripts/ci-diagnosis.ts',
  'scripts/decision-log-append.ts',
  'scripts/design-aggregate.ts',
  'scripts/lib/companion-file-sync.ts',
  'scripts/lib/state-write-guard.ts',
  'scripts/merge-base-guard.ts',
  'scripts/plan-quality-gate.ts',
  'scripts/promote-review-artifact.ts',
  'scripts/review-aggregate.ts',
  'scripts/triage-deferred-findings.ts',
  'scripts/v-test09-hooks-claim.ts',
  'scripts/validate-worker-json.ts',
];

// Presence-only: an import of `parseFlags` and/or `requireFlag` from a module path ending in
// `argv-flags` (relative import, any depth of `../`, with or without the `.ts` extension).
const IMPORT_REGEX = /import\s*\{[^}]*\b(parseFlags|requireFlag)\b[^}]*\}\s*from\s*['"][^'"]*argv-flags(?:\.ts)?['"]/;

export const hasArgvFlagsImport = (target: string): boolean => IMPORT_REGEX.test(read(target));

const checkArgvFlagsAdoption = (): CheckResult => {
  const violations = TARGET_SCRIPTS.filter((target) => !hasArgvFlagsImport(target));
  if (violations.length) return { id: 'V-ARGV-01', ok: false, detail: violations.join('; ') };
  return { id: 'V-ARGV-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkArgvFlagsAdoption()];
