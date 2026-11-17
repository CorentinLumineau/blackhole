import * as fs from 'fs';
import * as path from 'path';
import { read, root, type CheckResult } from './check-utils.ts';

// Issue #478 — stop mode: drain default + --abandon tier (#476 leg A).

export type InFlightEntry = { issue: string | number; worker: string };

// V-STOP-01: pure invariant — no in-flight entry names a worker outside the running set.
export const assertNoOrphanedInFlight = (
  inFlight: InFlightEntry[],
  runningWorkerIds: string[]
): CheckResult => {
  const running = new Set(runningWorkerIds);
  const orphans = inFlight.filter((e) => !running.has(e.worker));
  if (orphans.length) {
    return {
      id: 'V-STOP-01',
      ok: false,
      detail: orphans.map((o) => `#${o.issue} names ${o.worker} (not running)`).join('; '),
    };
  }
  return { id: 'V-STOP-01', ok: true };
};

// `flushed` is a real, emitted value as of issue #492 (leg B) — EVERY mention in
// checkpoint-protocol.md/phase-stop.md must cite #492 nearby, so the value's legitimizing issue
// stays discoverable at the point of use (this replaces the pre-#492 invariant, which required a
// "still reserved, do not emit" disclaimer instead). Shared between both files' checks below
// (`V-DRY-01`) — the two invariants are structurally identical since #492 landed.
//
// Universal, not existential: an `.exec()`-driven scan over every `flushed` occurrence, each
// re-checked against its own 80-char citation window — never a single whole-file `.test()`,
// which would pass on one cited mention while leaving nine stray uncited ones undetected
// (the exact failure mode this guard exists to catch, once `flushed` stopped being reserved).
const FLUSHED_CITATION_WINDOW = 80;

export const findUncitedFlushedMention = (content: string): boolean => {
  const flushedRe = /flushed/g;
  let match: RegExpExecArray | null;
  while ((match = flushedRe.exec(content))) {
    const window = content.slice(match.index, match.index + 'flushed'.length + FLUSHED_CITATION_WINDOW);
    if (!window.includes('#492')) return true;
  }
  return false;
};

// A usage stop (STOP-WORKERS / PACE-WAIT / STOP-CAMPAIGN, and NO-SPAWN) is a drain-and-wake
// pause: no prose that governs it may route to `--abandon`, mark a queue entry failed or blocked,
// or bump a retry counter. A match is exempt only when a negation precedes it inside its own
// clause; commas, colons, semicolons, sentence ends and table cells all end a clause, so a
// negation elsewhere in the sentence never covers a later instruction.
const FAILURE_ROUTES: [RegExp, string][] = [
  [/--abandon|\babandon\b/i, 'routes to --abandon'],
  [/\bfailed\b|\bblocked\b|\bretry counters?\b/i, 'marks a queue entry failed or blocked or bumps a retry counter'],
];
const GOVERNING_NEGATION = /\b(never|no|not|none)\b/i;

export const findUngovernedFailureRoutes = (text: string): string[] => {
  const clauses = text.replace(/\n(?!\s*\n)/g, ' ').split(/[.,;:|\n]/);
  const out: string[] = [];
  for (const clause of clauses) {
    for (const [pattern, label] of FAILURE_ROUTES) {
      const match = pattern.exec(clause);
      if (match && !GOVERNING_NEGATION.test(clause.slice(0, match.index))) out.push(`${label}: "${clause.trim()}"`);
    }
  }
  return out;
};

const sliceSection = (content: string, start: string, end: string): string | null => {
  const from = content.indexOf(start);
  if (from < 0) return null;
  const to = content.indexOf(end, from + start.length);
  return content.slice(from, to < 0 ? undefined : to);
};

export const findUsageStopViolations = (phaseStop: string): string[] => {
  const start = phaseStop.search(/^## Usage stop/m);
  if (start < 0) return ['phase-stop.md missing the ## Usage stop section'];
  const rest = phaseStop.slice(start + 1);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const errors: string[] = [];
  if (!section.includes('stopped_by: usage')) errors.push('usage stop does not record `stopped_by: usage`');
  if (!section.includes('wake_at')) errors.push('usage stop does not record `wake_at`');
  return [...errors, ...findUngovernedFailureRoutes(section).map((e) => `usage stop ${e}`)];
};

// The Spawn verdict table (with its closing paragraph) and Session resume step 7 in
// orchestrator-runtime.md, both of which decide what a usage stop does.
const RUNTIME_SECTIONS: [string, string, string][] = [
  ['usage verdict table', '| Verdict | Behaviour |', '\n2. When the round includes'],
  ['resume step 7', '7. **Resume after a pace or usage pause**', '\n\n'],
];

export const findUsageRuntimeViolations = (runtime: string): string[] =>
  RUNTIME_SECTIONS.flatMap(([name, start, end]) => {
    const section = sliceSection(runtime, start, end);
    if (section === null) return [`orchestrator-runtime.md missing the ${name}`];
    return findUngovernedFailureRoutes(section).map((e) => `${name} ${e}`);
  });

// Every spawn site (Pattern B `orchestrator-runtime.md` § Spawn, Pattern C
// `claude-code-native.md`, Pattern P `project-thread-mode.md`, or any other prose block) that runs
// the pace gate must run the usage gate in the same block, so the round's target is the minimum
// of both. A block is a blank-line-separated run of lines.
export const findSpawnSitesMissingUsageGate = (files: { path: string; content: string }[]): string[] => {
  const out: string[] = [];
  for (const file of files) {
    const missing = file.content.split(/\n\s*\n/).some((block) => block.includes('pace-gate.ts') && !block.includes('usage-budget.ts'));
    if (missing) out.push(`${file.path}: a block cites pace-gate.ts without usage-budget.ts`);
  }
  return out;
};

const SPAWN_SITE_DIRS = ['src/references', 'src/agents'];
// The three pattern spawn sites must each cite the usage gate, so a deleted citation cannot pass
// the block rule above by also deleting the pace-gate one.
const PATTERN_SPAWN_SITES = ['src/references/orchestrator-runtime.md', 'src/references/claude-code-native.md', 'src/references/project-thread-mode.md'];

// V-STOP-02: static conformance — SKILL.md cites phase-stop.md; phase-stop.md cites
// recovery-protocol.md §9 by reference (never restates its heal-actions steps);
// checkpoint-protocol.md declares the three fields this mode owns.
export const checkStopModeWiring = (): CheckResult => {
  const skill = read('src/SKILL.md');
  const phaseStop = read('src/references/phase-stop.md');
  const checkpoint = read('src/references/checkpoint-protocol.md');
  const orchestratorHandoff = read('src/references/orchestrator-handoff.md');
  const errors: string[] = [];

  if (!skill.includes('phase-stop.md')) errors.push('SKILL.md missing phase-stop.md citation');
  if (!phaseStop.includes('recovery-protocol.md') || !phaseStop.includes('§9')) {
    errors.push('phase-stop.md missing recovery-protocol.md §9 citation');
  }
  if (phaseStop.includes('Clear stale')) {
    errors.push('phase-stop.md restates §9.3 heal-actions steps instead of citing by reference');
  }
  for (const field of ['stopped_by', 'stop_kind', 'worker_state', 'wake_at']) {
    if (!checkpoint.includes(field)) errors.push(`checkpoint-protocol.md missing ${field} field`);
  }
  if (!/\| `stopped_by` \|[^\n]*`usage`/.test(checkpoint)) {
    errors.push('checkpoint-protocol.md stopped_by row does not accept `usage`');
  }
  if (findUncitedFlushedMention(checkpoint)) {
    errors.push('checkpoint-protocol.md emits `flushed` without citing issue #492');
  }

  // Issue #491 — stop --now leg A: worker-side ask wiring. Extends this existing check rather
  // than adding a new one.
  if (!phaseStop.includes('stop --now')) {
    errors.push('phase-stop.md missing the stop --now tier');
  }
  if (!phaseStop.includes('orchestrator-handoff.md')) {
    errors.push('phase-stop.md missing orchestrator-handoff.md citation for the flush ask');
  }
  if (!orchestratorHandoff.includes('Flush request')) {
    errors.push('orchestrator-handoff.md missing the Flush request section');
  }
  if (findUncitedFlushedMention(phaseStop)) {
    errors.push('phase-stop.md emits `flushed` without citing issue #492');
  }

  if (errors.length) return { id: 'V-STOP-02', ok: false, detail: errors.join('; ') };
  return { id: 'V-STOP-02', ok: true };
};

// V-STOP-03: the usage gate is wired into every spawn round and its stop is a drain-and-wake pause.
export const checkUsageGateWiring = (): CheckResult => {
  const files = SPAWN_SITE_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir))
      .filter((name) => name.endsWith('.md'))
      .map((name) => ({ path: `${dir}/${name}`, content: read(`${dir}/${name}`) })),
  );
  const errors = findSpawnSitesMissingUsageGate(files);
  for (const site of PATTERN_SPAWN_SITES) {
    if (!read(site).includes('usage-budget.ts')) errors.push(`${site} does not cite usage-budget.ts`);
  }
  errors.push(...findUsageStopViolations(read('src/references/phase-stop.md')));
  errors.push(...findUsageRuntimeViolations(read('src/references/orchestrator-runtime.md')));
  if (errors.length) return { id: 'V-STOP-03', ok: false, detail: errors.join('; ') };
  return { id: 'V-STOP-03', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkStopModeWiring(), checkUsageGateWiring()];
