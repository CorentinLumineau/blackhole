import type { ForgePr } from '../forge-adapter/types.ts';
import { waitReason } from './blocked-classes.ts';
import type { PendingDecision } from './pending-decisions.ts';
import { PARK_REASON } from './pending-decisions.ts';
import { ADDRESSES_OWNER } from './report.ts';
import { isSameRepoKey } from './queue.ts';
import type { QueueIssue } from './types.ts';

// What needs the owner besides parked decisions (`decision-parking.md` § Decide round): open PRs
// the owner gates by label, and blocked queue items whose notes address the owner. Pure; the
// forge read is the caller's, so tests never reach a forge. Forge text is data, rendered as is.

/** PR labels that mean "waiting for the owner" (compared case-insensitively). */
export const OWNER_PR_LABELS = ['needs-owner', 'owner-gated'] as const;

export type OwnerPr = { number: number; title: string; label: string };
export type OwnerBlocked = { number: number; title: string; note: string };
export type OwnerNeeds = { prs: OwnerPr[] | null; blocked: OwnerBlocked[] };

const byNumber = <T extends { number: number }>(a: T, b: T): number => a.number - b.number;

/** Numbers a parked decision already covers: what it blocks, plus every `#n` its text cites. */
function citedNumbers(parked: PendingDecision[]): Set<number> {
  const cited = new Set<number>();
  for (const d of parked) {
    for (const n of d.blocks) cited.add(n);
    for (const m of `${d.question} ${d.evidence ?? ''}`.matchAll(/#(\d+)\b/g)) cited.add(Number(m[1]));
  }
  return cited;
}

/**
 * The owner-needing items not already parked. `prs` null (forge unread) stays null so the report
 * never reads an unread forge as "none".
 */
export function collectOwnerNeeds(input: {
  prs: ForgePr[] | null;
  issues: Record<string, QueueIssue> | null;
  parked: PendingDecision[];
}): OwnerNeeds {
  const cited = citedNumbers(input.parked);
  const issues = input.issues ?? {};
  const own = Object.entries(issues).filter(([k]) => isSameRepoKey(k));
  const issueOfPr = new Map<number, number>();
  for (const [k, i] of own) if (i.pr != null) issueOfPr.set(i.pr, Number(k));

  const prs = input.prs
    ? input.prs
        .filter((p) => p.state === 'OPEN')
        .flatMap((p) => {
          const label = (p.labels ?? []).find((l) => (OWNER_PR_LABELS as readonly string[]).includes(l.toLowerCase()));
          const issue = issueOfPr.get(p.number);
          if (!label || cited.has(p.number) || (issue !== undefined && cited.has(issue))) return [];
          return [{ number: p.number, title: p.title, label: label.toLowerCase() }];
        })
        .sort(byNumber)
    : null;

  const blocked = own
    .filter(([, i]) => i.status === 'blocked' && !(i.notes ?? '').trim().startsWith(PARK_REASON))
    .filter(([, i]) => ADDRESSES_OWNER.test(i.notes ?? '') || waitReason(i, issues).owner)
    .filter(([k, i]) => !cited.has(Number(k)) && !(i.pr != null && cited.has(i.pr)))
    .map(([k, i]) => ({ number: Number(k), title: i.title ?? '', note: (i.notes ?? '').trim() }))
    .sort(byNumber);

  return { prs, blocked };
}

/** The report lines for the decide round: PRs first, then blocked items, each ascending. */
export function renderOwnerNeeds(needs: OwnerNeeds): string {
  const prs = needs.prs === null ? 'not read (forge unavailable)' : needs.prs.length ? needs.prs.map((p) => `#${p.number} ${p.title} (${p.label})`).join('; ') : 'none';
  const blocked = needs.blocked.length ? needs.blocked.map((b) => `#${b.number} ${b.title} — ${b.note}`).join('; ') : 'none';
  return [`- Also needing you (not parked):`, `  - open PRs needing you: ${prs}.`, `  - blocked items addressed to you: ${blocked}.`].join('\n');
}
