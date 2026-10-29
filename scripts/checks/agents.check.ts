import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatterFields, parseMdFrontmatter } from '../lib/build/content.ts';
import { root, read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers, readComposedAgentDoc } from '../lib/check-common.ts';

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

/** Claude Code 2.1.292–2.1.296 frontmatter: `effort: low` for triage/routing, `high` for
 * review/verification, `autoCompactWindow` (token threshold) for long-running workers. Absent
 * keys must stay absent — a stray `effort:` on planner/implementer would pin session effort
 * against `worker_effort_policy` spawn routing in model-routing.md. */
export type AgentFrontmatterPolicy = { effort?: 'low' | 'high'; autoCompactWindow?: string };

export const AGENT_FRONTMATTER_POLICY: Record<string, AgentFrontmatterPolicy> = {
  'coordinator.md': { effort: 'low' },
  'router.md': { effort: 'low' },
  'orchestrator.md': { effort: 'low', autoCompactWindow: '100000' },
  'planner.md': { autoCompactWindow: '100000' },
  'implementer.md': { autoCompactWindow: '100000' },
  'reviewer.md': { effort: 'high' },
  'hunter.md': { effort: 'high', autoCompactWindow: '100000' },
  'investigator.md': { autoCompactWindow: '100000' },
};

export const validateAgentEffortFrontmatter = (
  file: string,
  fm: Record<string, string>,
  expected: AgentFrontmatterPolicy,
): string[] => {
  const errors: string[] = [];
  if (expected.effort) {
    if (fm.effort !== expected.effort) {
      errors.push(`${file}: expected effort: ${expected.effort}, got ${fm.effort ?? '(absent)'}`);
    }
  } else if (fm.effort) {
    errors.push(`${file}: unexpected effort: ${fm.effort}`);
  }
  if (expected.autoCompactWindow) {
    if (fm.autoCompactWindow !== expected.autoCompactWindow) {
      errors.push(
        `${file}: expected autoCompactWindow: ${expected.autoCompactWindow}, got ${fm.autoCompactWindow ?? '(absent)'}`,
      );
    }
  } else if (fm.autoCompactWindow) {
    errors.push(`${file}: unexpected autoCompactWindow: ${fm.autoCompactWindow}`);
  }
  return errors;
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
    const fmBody = parseMdFrontmatter(content).frontmatter;
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
    const { frontmatter } = parseMdFrontmatter(content);
    if (!frontmatter) {
      missing.push(`${file}: no frontmatter`);
      continue;
    }
    for (const key of ['name:', 'description:']) {
      if (!frontmatter.includes(key)) missing.push(`${file}: missing ${key}`);
    }
    if (/\bmodel:/.test(frontmatter)) missing.push(`${file}: model must be absent (inherit harness default)`);
    const policy = AGENT_FRONTMATTER_POLICY[file];
    if (policy) {
      missing.push(...validateAgentEffortFrontmatter(file, parseFrontmatterFields(frontmatter), policy));
    }
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

const checkGateContentAssertions = (): CheckResult => {
  const implementerContent = readComposedAgentDoc('src/agents/implementer.md');
  const reviewerContent = readComposedAgentDoc('src/agents/reviewer.md');

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
