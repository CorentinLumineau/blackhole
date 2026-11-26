import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runRecord } from '../../campaign-record.ts';
import { systemHoldDeps } from './keep-awake.ts';
import {
  blockedReturnDecisions,
  OWNER_GATE_UNCHECKED,
  ownerGateConfig,
  ownerGateDecisions,
  systemOwnerGateReader,
  type OwnerGatePr,
  type OwnerGateReader,
} from './owner-gate.ts';
import type { PendingDecision, WakeCardQuestion } from './pending-decisions.ts';
import type { QueueIssue } from './types.ts';

// `/blackhole decide` lists PRs held by the consumer's owner gate (`decisions.owner_gate`) and
// blocked owner questions beside the parked ones: a fixture queue, a stubbed forge PR list, and a
// forge that fails. Label names are neutral on purpose: the plugin hardcodes none.

const NOW = new Date('2026-11-26T09:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const GATE = { pending_label: 'gate:pending', approved_label: 'gate:approved' };

const QUEUE: Record<string, QueueIssue> = {
  '10': { status: 'in-flight', phase: 'review', pr: 100 },
  '11': { status: 'blocked', depends_on: [10] },
  '12': { status: 'in-flight', phase: 'review', pr: 120 },
  '20': { status: 'blocked', title: 'Pick a palette', notes: 'blocked-escalated: which palette, warm or cool?' },
  '21': { status: 'blocked', notes: 'awaiting-owner-on-return' },
  '22': { status: 'blocked', notes: 'awaiting-design-approval' },
  '23': { status: 'blocked', notes: 'overlap with #10' },
};

const GATED_PRS: OwnerGatePr[] = [
  { number: 100, title: 'Gated deploy', labels: ['gate:pending'] },
  { number: 120, title: 'Already approved', labels: ['gate:pending', 'gate:approved'] },
];
const reads: unknown[] = [];
const GATED: OwnerGateReader = (_config, gate) => {
  reads.push(gate);
  return { status: 'ok', prs: GATED_PRS };
};
const DOWN: OwnerGateReader = () => ({ status: 'unavailable', reason: 'HTTP 502' });

const dirs: string[] = [];
function campaign(config: Record<string, unknown>, pending: PendingDecision[] = [], queue = QUEUE): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-owner-gate-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ repo: 'acme/app', ...config }));
  fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify({ issues: queue }));
  if (pending.length) fs.writeFileSync(path.join(dir, 'pending-decisions.json'), JSON.stringify({ next_id: pending.length + 1, decisions: pending }));
  return dir;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const GATED_CONFIG = { decisions: { owner_gate: GATE } };
const decide = (dir: string, reader: OwnerGateReader) => JSON.parse(runRecord(['decide', '--campaign-dir', dir], NOW, systemHoldDeps, reader));
const ids = (out: { cards: WakeCardQuestion[][] }) => out.cards.flat().map((q) => q.id);

const PARKED: PendingDecision = {
  id: 'PD-1', question: 'Approve the plan for #22?', options: [{ label: 'Approve' }, { label: 'Rework' }],
  recommended: 0, blocks: [22], gate: 'plan-approval', created_at: '2026-11-25T08:00:00.000Z',
};

describe('ownerGateConfig', () => {
  test('absent block is inert, a full block is used, a partial one is named invalid', () => {
    expect(ownerGateConfig({})).toBeNull();
    expect(ownerGateConfig({ decisions: { mode: 'park' } })).toBeNull();
    expect(ownerGateConfig(GATED_CONFIG)).toEqual(GATE);
    expect(ownerGateConfig({ decisions: { owner_gate: { pending_label: 'x' } } })).toEqual({
      invalid: 'decisions.owner_gate needs pending_label and approved_label',
    });
  });
});

describe('ownerGateDecisions', () => {
  test('a PR with the pending label and not the approved one is listed with what it unblocks; an approved one is not', () => {
    const out = ownerGateDecisions(GATED_PRS, GATE, QUEUE, NOW_ISO);
    expect(out.map((d) => d.id)).toEqual(['PR-100']);
    expect(out[0].blocks).toEqual([10, 11, 100]);
    expect(out[0].options.map((o) => o.label)).toEqual(['Approve', 'Hold']);
    expect(out[0].options[0].consequence).toContain('adds gate:approved on the current head of PR #100');
  });
});

describe('blockedReturnDecisions', () => {
  test('an escalated or awaiting blocked item is asked; a parked or non-owner one is not', () => {
    const out = blockedReturnDecisions(QUEUE, [PARKED], NOW_ISO);
    expect(out.map((d) => d.id)).toEqual(['BR-20']);
    expect(out[0].question).toBe('#20 (Pick a palette) waits on you: which palette, warm or cool?');
  });
});

describe('campaign-record decide with the owner gate', () => {
  test('block absent: the forge is not read and the report says nothing about gated PRs', () => {
    const before = reads.length;
    const out = decide(campaign({}, [PARKED]), GATED);
    expect(reads.length).toBe(before);
    expect(ids(out)).toEqual(['PD-1', 'BR-20']);
    expect(out.report).toContain('- Decisions waiting for you: 2, asked next.');
    expect(out.report).not.toContain('owner-gated');
  });

  test('block set: the pending PR joins the parked decision and the blocked return, most-blocking first', () => {
    const out = decide(campaign(GATED_CONFIG, [PARKED]), GATED);
    expect(reads.at(-1)).toEqual(GATE);
    expect(Object.keys(out)).toEqual(['report', 'total', 'blocked_items', 'cards']);
    expect(ids(out)).toEqual(['PR-100', 'PD-1', 'BR-20']);
    expect(out.total).toBe(3);
    expect(out.blocked_items).toEqual([10, 11, 20, 22, 100]);
    expect(out.report).toContain('- Decisions waiting for you: 3, asked next.');
  });

  test('block set and the forge fails: the gated PRs are unchecked, never a bare none', () => {
    const out = decide(campaign(GATED_CONFIG), DOWN);
    expect(ids(out)).toEqual(['BR-20', 'BR-22']);
    expect(out.report).toContain(`- Decisions waiting for you: 2, asked next; ${OWNER_GATE_UNCHECKED} (HTTP 502).`);
    const empty = decide(campaign(GATED_CONFIG, [], {}), DOWN);
    expect(empty.total).toBe(0);
    expect(empty.report).toContain(`- Decisions waiting for you: none found; ${OWNER_GATE_UNCHECKED} (HTTP 502).`);
  });

  test('a blocked issue whose PR is gated is asked once, as the PR card', () => {
    const queue = { ...QUEUE, '10': { status: 'blocked', pr: 100, notes: 'awaiting-owner-gate on PR #100' } };
    const out = decide(campaign(GATED_CONFIG, [PARKED], queue), GATED);
    expect(ids(out)).toEqual(['PR-100', 'PD-1', 'BR-20']);
  });

  test('decide never writes the forge decisions to pending-decisions.json', () => {
    const dir = campaign(GATED_CONFIG);
    decide(dir, GATED);
    expect(fs.existsSync(path.join(dir, 'pending-decisions.json'))).toBe(false);
  });
});

describe('systemOwnerGateReader', () => {
  test('no repo, or a forge other than GitHub, is unavailable without spawning the forge', () => {
    expect(systemOwnerGateReader({}, GATE)).toEqual({ status: 'unavailable', reason: 'no repo in config.json' });
    expect(systemOwnerGateReader({ repo: 'acme/app', forge: 'gitea' }, GATE).status).toBe('unavailable');
  });
});
