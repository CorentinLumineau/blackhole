import type { ForgeAdapter, ForgeCheck, ForgeIssue, ForgePr, ForgeType } from '../forge-adapter/types.ts';

/** What a test script of the status page answers; a read it leaves out fails as the forge would. */
export type FakeForge = {
  forge?: ForgeType;
  issues?: ForgeIssue[];
  /** Pull requests by state: `all` answers a list of any state, `open` one of open PRs. */
  prs?: { open?: ForgePr[]; all?: ForgePr[] };
  /** The PR row `prView` answers, by number; a number left out rejects. */
  views?: Record<number, ForgePr>;
  /** The checks `prChecks` answers, by number; a number left out rejects. */
  checks?: Record<number, ForgeCheck[]>;
};

export type FakeForgeAdapter = ForgeAdapter & { calls: string[] };

const missing = (what: string): never => {
  throw new Error(`fake forge: ${what} is not scripted`);
};

/** A `ForgeAdapter` for the status page's forge reads, recording each call as `name:argument`. */
export function fakeForge(script: FakeForge = {}): FakeForgeAdapter {
  const calls: string[] = [];
  const adapter = {
    forge: script.forge ?? 'gitea',
    repo: 'acme/widgets',
    calls,
    async issueList() {
      calls.push('issueList');
      return script.issues ?? missing('issueList');
    },
    async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}) {
      calls.push(`prList:${filter.state ?? 'open'}:${filter.limit ?? ''}`);
      const rows = filter.state === 'open' || filter.state === undefined ? script.prs?.open : script.prs?.all;
      return rows ?? missing(`prList ${filter.state}`);
    },
    async prView(n: number) {
      calls.push(`prView:${n}`);
      return script.views?.[n] ?? missing(`prView ${n}`);
    },
    async prChecks(n: number) {
      calls.push(`prChecks:${n}`);
      return script.checks?.[n] ?? missing(`prChecks ${n}`);
    },
  };
  return adapter as unknown as FakeForgeAdapter;
}

/** A pull request row with the fields the status page reads; override what a test cares about. */
export const prRow = (number: number, extra: Partial<ForgePr> = {}): ForgePr => ({
  number,
  title: `PR ${number}`,
  body: '',
  headRefName: `branch-${number}`,
  headRefOid: `sha${number}`,
  state: 'OPEN',
  mergedAt: null,
  ...extra,
});
