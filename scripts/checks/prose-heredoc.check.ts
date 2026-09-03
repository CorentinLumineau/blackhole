import { read, type CheckResult } from './check-utils.ts';
import { listFiles } from '../lib/check-common.ts';

// R-12b (ADR-003) — a step whose output is a pure function of files or JSON belongs in a
// `scripts/<name>.ts` invocation, not agent prose. R-10 (#715, merged) replaced the last
// literal fenced `cat <<` heredoc doc-write in agent prose with a script invocation
// (`scripts/carry-staged-artifacts.ts`); this check keeps that absence enforced instead of
// incidental — a fenced code block in `src/agents/*.md` containing a `cat <<` heredoc that
// writes (directly or via `mv`) into `documentation/` or `.blackhole/staged/` is flagged.

const CAT_HEREDOC = /cat\s*<</;
const FLAGGED_REDIRECT = /(>{1,2}|mv\s+\S+\s+)\s*['"]?[^\s'"]*(documentation\/|\.blackhole\/staged\/)/;

// Fence-scoped and redirect-line-scoped, not whole-block substring matching: the word
// "documentation/" appearing only in heredoc *body* prose (never on a redirect/`mv` line) must
// never flag. One flag per heredoc, at the `cat <<` line (1-indexed).
export const findHeredocDocWrites = (mdContent: string): number[] => {
  const lines = mdContent.split('\n');
  const hits: number[] = [];
  let inFence = false;
  let pendingHeredocLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      if (!inFence) pendingHeredocLine = null;
      continue;
    }
    if (!inFence) continue;

    if (pendingHeredocLine === null && CAT_HEREDOC.test(line)) {
      pendingHeredocLine = i + 1;
    }

    if (pendingHeredocLine !== null && FLAGGED_REDIRECT.test(line)) {
      hits.push(pendingHeredocLine);
      pendingHeredocLine = null;
    }
  }

  return hits;
};

export const checkProseHeredocInAgentProse = (
  files: Record<string, string> = Object.fromEntries(
    listFiles('src/agents').map((f) => [`src/agents/${f}`, read(`src/agents/${f}`)]),
  ),
): CheckResult => {
  const allHits: string[] = [];
  for (const [file, content] of Object.entries(files)) {
    for (const line of findHeredocDocWrites(content)) {
      allHits.push(`${file}:${line}`);
    }
  }
  if (allHits.length === 0) return { id: 'V-PROSE-01', ok: true };
  return { id: 'V-PROSE-01', ok: false, detail: allHits.join('; ') };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkProseHeredocInAgentProse()];
