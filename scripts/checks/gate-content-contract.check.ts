import { read, type CheckResult } from './check-utils.ts';

// ADR-007 T5/R2' — gate-content-contract.check.ts: R-003 Gate Content Contract cross-reference
// check, extracted from playbook.check.ts (issue #535) to create real headroom under the shared
// `scripts/checks/*.check.ts` content-gate budget rather than raising it — playbook.check.ts sat
// at 218/218 with zero room for the brace fix below, the same trap #473 hit at 918/918.

const GATE_CONTENT_FILES = ['src/references/epic-orchestration.md', 'src/references/issue-splitting.md', 'src/references/confidence-gates.md', 'src/references/phase-plan.md', 'src/references/merge-gate.md', 'src/references/phase-review.md', 'src/agents/coordinator.md', 'src/agents/planner.md'];
export const checkGateContentContract = (
  clarifyGatesContent: string = read('src/references/clarify-gates.md'),
  gateFiles: Record<string, string> = Object.fromEntries(GATE_CONTENT_FILES.map((f) => [f, read(f)])),
): CheckResult => {
  const missing: string[] = [];
  if (!clarifyGatesContent.includes('## Gate Content Contract (R-003)')) missing.push('clarify-gates.md: missing heading');
  for (const [file, content] of Object.entries(gateFiles)) {
    if (!content.includes('Gate Content Contract')) missing.push(`${file}: missing reference`);
  }
  return missing.length ? { id: 'V-GATECONTENT-01', ok: false, detail: missing.join('; ') } : { id: 'V-GATECONTENT-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkGateContentContract()];
