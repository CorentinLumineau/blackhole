import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';

// ADR-007 T5/R2' — agents.check.ts: agent roster frontmatter, tool-policy, delegation-contract,
// and gate-marker checks (split from the former catch-all check file, issue #322).

const srcDir = path.join(root, 'src');

// V-TOOLS-01: Deny-list tool policy — no tools: allowlist; correct disallowedTools per role
export const AGENT_TOOL_POLICY_DENY_MATRIX: Record<string, string[] | null> = {
  'coordinator.md': ['Write', 'Edit', 'Delete'],
  'orchestrator.md': ['Write', 'Edit', 'Delete'],
  'planner.md': ['Delete'],
  'implementer.md': null,
  'reviewer.md': ['Write', 'Edit', 'Delete'],
  'router.md': ['Write', 'Edit', 'Delete'],
  'investigator.md': ['Write', 'Edit', 'Delete'],
  'hunter.md': ['Write', 'Edit', 'Delete'],
};

export const validateAgentToolPolicyFrontmatter = (
  file: string,
  fmBody: string,
  expected: string[] | null,
): string[] => {
  const errors: string[] = [];

  if (/^tools:/m.test(fmBody)) {
    errors.push(`${file}: has tools: allowlist (use deny-list only)`);
  }

  if (expected === null) {
    // implementer: disallowedTools must be absent (full access by design — AGENT_TOOL_POLICY_DENY_MATRIX is the SSOT)
    if (/^disallowedTools:/m.test(fmBody)) {
      errors.push(`${file}: must NOT have disallowedTools (implementer requires full tool access)`);
    }
  } else if (expected) {
    if (!fmBody.includes('disallowedTools:')) {
      errors.push(`${file}: missing disallowedTools`);
    } else {
      for (const tool of expected) {
        if (!fmBody.includes(tool)) {
          errors.push(`${file}: disallowedTools missing ${tool}`);
        }
      }
    }
  }

  return errors;
};

const checkAgentToolPolicy = (): CheckResult => {
  const agentsDir = path.join(srcDir, 'agents');
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const errors: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    const fmBody = fm ? fm[1] : '';
    const expected = AGENT_TOOL_POLICY_DENY_MATRIX[file];
    errors.push(...validateAgentToolPolicyFrontmatter(file, fmBody, expected));
  }

  if (errors.length) return { id: 'V-TOOLS-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-TOOLS-01', ok: true };
};

// V-AGENT-01: Agent frontmatter
const checkAgentFrontmatter = (): CheckResult => {
  const agentsDir = path.join(srcDir, 'agents');
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const missing: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      missing.push(`${file}: no frontmatter`);
      continue;
    }
    for (const key of ['name:', 'description:']) {
      if (!fm[1].includes(key)) missing.push(`${file}: missing ${key}`);
    }
    if (/\bmodel:/.test(fm[1])) missing.push(`${file}: model must be absent (inherit harness default)`);
  }

  if (missing.length) return { id: 'V-AGENT-01', ok: false, detail: missing.join('; ') };
  return { id: 'V-AGENT-01', ok: true };
};

// V-DELEG-01: Worker agents declare contract sections
const checkDelegationContracts = (): CheckResult => {
  const workers = ['planner.md', 'implementer.md'];
  const missing: string[] = [];

  for (const file of workers) {
    const content = read(`src/agents/${file}`);
    if (!/5-Field|5-field|Scope Boundaries|Touch-Paths/i.test(content)) {
      missing.push(file);
    }
  }

  const outputAgents = ['reviewer.md', 'planner.md', 'implementer.md', 'router.md', 'investigator.md'];
  for (const file of outputAgents) {
    const content = read(`src/agents/${file}`);
    if (!/worker-schemas|Output format|Return format/i.test(content)) {
      missing.push(`${file}: no output schema reference`);
    }
  }

  const orch = read('src/agents/orchestrator.md');
  if (!orch.includes('5-Field Delegation Contract')) {
    missing.push('orchestrator.md: no 5-field section');
  }

  if (missing.length) return { id: 'V-DELEG-01', ok: false, detail: missing.join('; ') };
  return { id: 'V-DELEG-01', ok: true };
};

// V-GATE-01: implementer.md's 5-step verification-evidence gate and reviewer.md's §12
// Suggestion Proportionality Gate keep their required marker text — regression guard for #204/#211
// and #207/#212. The reviewer marker below uses a contiguous phrase from the actual file text
// rather than the "single current consumer" paraphrase, because that paraphrase wraps across a
// line break in reviewer.md and is not a literal substring (see issue #219 plan discussion).
export const IMPLEMENTER_GATE_REQUIRED_MARKERS = [
  '5-step gate',
  '**IDENTIFY**',
  '**RUN**',
  '**READ**',
  '**VERIFY**',
  '**CLAIM**',
  'should work" / "should pass" / "probably" / "likely"',
  'based on the code" / "based on my analysis"',
];

export const REVIEWER_PROPORTIONALITY_REQUIRED_MARKERS = [
  'Suggestion Proportionality Gate',
  'abstraction layer (interface, factory, strategy) for a single',
];

// Shared filter: which of `required` are absent from `content`. Used by this file's own
// V-GATE-01 check and re-exported (unchanged) by single-writer.check.ts, coverage-regression.check.ts,
// and design-track.check.ts for their own gate-marker checks — one definition, ADR-007 R6/V-INT-02
// (no local reimplementation of an equivalently-shaped filter function).
export const findMissingGateMarkers = (content: string, required: string[]): string[] =>
  required.filter((marker) => !content.includes(marker));

const checkGateContentAssertions = (): CheckResult => {
  const implementerContent = read('src/agents/implementer.md');
  const reviewerContent = read('src/agents/reviewer.md');

  const implementerMissing = findMissingGateMarkers(implementerContent, IMPLEMENTER_GATE_REQUIRED_MARKERS);
  const reviewerMissing = findMissingGateMarkers(reviewerContent, REVIEWER_PROPORTIONALITY_REQUIRED_MARKERS);

  const errors = [
    ...implementerMissing.map((m) => `implementer.md missing "${m}"`),
    ...reviewerMissing.map((m) => `reviewer.md missing "${m}"`),
  ];

  if (errors.length) return { id: 'V-GATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-GATE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — a single pure function returning this domain's
// CheckResult[], no side effects (console.log stays in scripts/verify.ts, the thin runner).
// scripts/verify.ts glob-discovers scripts/checks/*.check.ts and calls each module's exported
// runChecks() — no central registry file (ADR-007 critics' binding rejection of a check-registry
// hub).
export const runChecks = (): CheckResult[] => [
  checkAgentToolPolicy(),
  checkAgentFrontmatter(),
  checkDelegationContracts(),
  checkGateContentAssertions(),
];
