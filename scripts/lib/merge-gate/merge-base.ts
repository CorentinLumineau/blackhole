// merge-gate.md § 7 — the mechanical half of the merge-base gate. Everything here is a pure
// function of its arguments (the subprocess call that reads git lives in the CLI wrapper), so
// the base assertion and the post-merge landing verdict are decided by code, never by an
// orchestrator's judgement about whether a miss "is probably fetch lag".

export type BaseAssertion = { ok: boolean; reason?: string };

/**
 * Pre-merge base assertion. A PR may merge when its `baseRefName` is the campaign
 * `target_branch`, or when an explicit stacked-merge opt-in names the very branch being landed
 * into. Every other combination — including an opt-in that names a branch other than the PR's
 * actual base, and an unreadable base — is a refusal: stacking stays possible, silence does not.
 */
export function assertPreMergeBase(opts: {
  baseRefName: string;
  targetBranch: string;
  stackedInto?: string | null;
}): BaseAssertion {
  const { baseRefName, targetBranch } = opts;
  const stackedInto = opts.stackedInto || null;

  if (!baseRefName) {
    return { ok: false, reason: 'PR baseRefName unreadable — the merge base cannot be asserted' };
  }
  if (baseRefName === targetBranch) {
    if (stackedInto && stackedInto !== targetBranch) {
      return {
        ok: false,
        reason: `stacked-merge opt-in names ${stackedInto}, but the PR's base is the campaign target ${targetBranch}`,
      };
    }
    return { ok: true };
  }
  if (!stackedInto) {
    return {
      ok: false,
      reason: `PR base is ${baseRefName}, not the campaign target ${targetBranch} — a stacked merge requires an explicit opt-in naming ${baseRefName}`,
    };
  }
  if (stackedInto !== baseRefName) {
    return {
      ok: false,
      reason: `stacked-merge opt-in names ${stackedInto}, but the PR's base is ${baseRefName}`,
    };
  }
  return { ok: true };
}

/**
 * True when a `git log <branch>` subject listing contains a commit attributable to this PR —
 * a squash-merge subject's trailing `(#N)` or a merge commit's `Merge pull request #N`. The
 * digit boundaries keep `#793` from matching `#7930` or `#1793`.
 */
export function landedOnBranch(gitLogOutput: string, prNumber: number): boolean {
  if (!gitLogOutput.trim()) return false;
  return new RegExp(String.raw`(?<!\d)#${prNumber}(?!\d)`).test(gitLogOutput);
}

export type PostMergeVerdict = 'verified' | 'retry' | 'failed';

/**
 * Post-merge landing verdict for one attempt. A miss is `retry` only while attempts remain;
 * at the cap it is `failed`, which is terminal — there is no verdict meaning "tolerate it".
 */
export function classifyPostMergeVerification(opts: {
  landed: boolean;
  attempt: number;
  maxAttempts: number;
}): PostMergeVerdict {
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${opts.maxAttempts}`);
  }
  if (!Number.isInteger(opts.attempt) || opts.attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${opts.attempt}`);
  }
  if (opts.landed) return 'verified';
  return opts.attempt >= opts.maxAttempts ? 'failed' : 'retry';
}

/**
 * Bounded retry loop around `classifyPostMergeVerification`. `readLog` and `wait` are injected
 * so the loop itself stays pure and testable; the CLI supplies the real `git` read and sleep.
 */
export function verifyPostMergeLanding(opts: {
  prNumber: number;
  targetBranch: string;
  maxAttempts: number;
  intervalMs: number;
  readLog: (attempt: number) => string;
  wait: (ms: number) => void;
}): { ok: boolean; attempts: number; reason?: string } {
  for (let attempt = 1; ; attempt += 1) {
    const verdict = classifyPostMergeVerification({
      landed: landedOnBranch(opts.readLog(attempt), opts.prNumber),
      attempt,
      maxAttempts: opts.maxAttempts,
    });
    if (verdict === 'verified') return { ok: true, attempts: attempt };
    if (verdict === 'failed') {
      return {
        ok: false,
        attempts: attempt,
        reason: `no commit for PR #${opts.prNumber} on ${opts.targetBranch} after ${attempt} attempt(s) — the merge did not land there`,
      };
    }
    opts.wait(opts.intervalMs);
  }
}

export type MergedIntoVerdict = 'base' | 'other' | 'unknown';

/**
 * `queue.json` `status: merged` semantics. `merged_into` records the branch the PR actually
 * landed on; its absence is reported as `unknown` rather than assumed to be the campaign base,
 * so a row predating the field is never mistaken for a verified base-ref merge.
 */
export function mergedIntoVerdict(
  issue: { status?: string; merged_into?: string | null },
  targetBranch: string,
): MergedIntoVerdict {
  if (issue.status !== 'merged') return 'unknown';
  if (!issue.merged_into) return 'unknown';
  return issue.merged_into === targetBranch ? 'base' : 'other';
}
