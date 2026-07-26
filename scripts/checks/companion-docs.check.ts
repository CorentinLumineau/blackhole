import { read, type CheckResult } from './check-utils.ts';

// ADR-007 T5/R2' — companion-docs.check.ts: matches verify.companion-docs.test.ts.

// V-ADADOC-01: blackhole-vcodes.md documents the V-ADA family; reviewer.md documents Companion-File Audit
export const COMPANION_FILE_REQUIRED_VCODES = ['V-ADA-01', 'V-ADA-02', 'V-ADA-03', 'V-ADA-05/06/07'];

export const findMissingCompanionVcodes = (
  content: string,
  required: string[] = COMPANION_FILE_REQUIRED_VCODES,
): string[] => required.filter((code) => !content.includes(code));

const checkCompanionFileDocs = (): CheckResult => {
  const vcodesMissing = findMissingCompanionVcodes(read('src/references/blackhole-vcodes.md'));
  const reviewerMissing = read('src/agents/reviewer.md').includes('Companion-File Audit')
    ? []
    : ['reviewer.md: no Companion-File Audit section'];
  const errors = [...vcodesMissing.map((c) => `blackhole-vcodes.md missing ${c}`), ...reviewerMissing];

  if (errors.length) return { id: 'V-ADADOC-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-ADADOC-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkCompanionFileDocs()];
