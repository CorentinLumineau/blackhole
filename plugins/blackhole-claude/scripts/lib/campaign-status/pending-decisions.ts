import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { installStateFile } from '../state-write-guard.ts';

// Sleep mode (`sleep-mode.md`): while the owner is away the campaign never asks. Each question it
// would have put to the owner is parked here instead, and the wake-up turn asks them all at once.
// `.blackhole/pending-decisions.json` is written only through `scripts/campaign-record.ts park` and
// `resolve`, so its shape is checked once, here.

export const PENDING_DECISIONS_FILE = 'pending-decisions.json';
export const PENDING_ENTITY_KEY = 'decisions';
/** The queue `notes` value of an item parked on a pending decision (`clarify-gates.md` § Queue status). */
export const PARK_REASON = 'awaiting-owner-on-return';
/** One AskUserQuestion call takes at most four questions, and each question two to four options. */
export const QUESTIONS_PER_CARD = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

export type PendingOption = { label: string; consequence?: string };

export type PendingDecision = {
  id: string;
  /** The question exactly as it would have been asked. */
  question: string;
  options: PendingOption[];
  /** Index into `options` of the recommended answer. */
  recommended: number;
  evidence?: string;
  /** Issue or PR numbers parked until the owner answers. */
  blocks: number[];
  /** Which gate parked it (clarify, plan-approval, design-approval, mockup, ruling, …). */
  gate?: string;
  created_at: string;
};

/** True only when `config.json` says `sleep_mode.enabled: true`. Absent or anything else ⇒ awake. */
export function isSleepMode(config: unknown): boolean {
  const block = (config as { sleep_mode?: { enabled?: unknown } } | null)?.sleep_mode;
  return block?.enabled === true;
}

/** The one choke point every owner question goes through: ask now, or park it for the wake-up round. */
export function askOrPark(config: unknown): 'ask' | 'park' {
  return isSleepMode(config) ? 'park' : 'ask';
}

/** Why `d` is not a valid pending decision, or null when it is. */
export function pendingDecisionError(d: unknown): string | null {
  if (typeof d !== 'object' || d === null) return 'is not an object';
  const r = d as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^PD-\d+$/.test(r.id)) return 'has no "PD-<n>" id';
  if (typeof r.question !== 'string' || !r.question.trim()) return `${r.id} has no question`;
  const options = r.options;
  if (!Array.isArray(options) || options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return `${r.id} needs ${MIN_OPTIONS} to ${MAX_OPTIONS} options`;
  }
  if (options.some((o) => typeof o?.label !== 'string' || !o.label.trim())) return `${r.id} has an option without a label`;
  const rec = r.recommended;
  if (typeof rec !== 'number' || !Number.isInteger(rec) || rec < 0 || rec >= options.length) {
    return `${r.id} recommends no listed option`;
  }
  if (!Array.isArray(r.blocks) || r.blocks.some((b) => !Number.isInteger(b) || b <= 0)) return `${r.id} has invalid blocks`;
  if (typeof r.created_at !== 'string' || Number.isNaN(Date.parse(r.created_at))) return `${r.id} has no created_at`;
  return null;
}

/** The parked decisions in recorded order; absent ⇒ none. A malformed file throws: never guess. */
export function readPendingDecisions(campaignDir: string): PendingDecision[] {
  const file = path.join(campaignDir, PENDING_DECISIONS_FILE);
  if (!fs.existsSync(file)) return [];
  const list = (readJsonFile(file, file) as { decisions?: unknown })?.decisions;
  if (!Array.isArray(list)) throw new Error(`${file} has no "decisions" array; fix it before parking or resolving.`);
  for (const d of list) {
    const why = pendingDecisionError(d);
    if (why) throw new Error(`${file}: a decision ${why}.`);
  }
  return list as PendingDecision[];
}

/**
 * Parks one decision. The same question parked again is not listed twice: it gains the new
 * `blocks` and keeps its id and date, so the cost of waiting stays honest.
 */
export function addPendingDecision(
  list: PendingDecision[],
  next: Omit<PendingDecision, 'id'>,
): { list: PendingDecision[]; decision: PendingDecision } {
  const twin = list.find((d) => d.question === next.question);
  if (twin) {
    const merged = { ...twin, blocks: [...new Set([...twin.blocks, ...next.blocks])] };
    return { list: list.map((d) => (d === twin ? merged : d)), decision: merged };
  }
  const n = list.reduce((max, d) => Math.max(max, Number(d.id.slice(3))), 0) + 1;
  const decision: PendingDecision = { id: `PD-${n}`, ...next };
  const why = pendingDecisionError(decision);
  if (why) throw new Error(`The decision ${why}.`);
  return { list: [...list, decision], decision };
}

/** Removes the answered decision; throws when `id` is not parked. */
export function resolvePendingDecision(
  list: PendingDecision[],
  id: string,
): { list: PendingDecision[]; decision: PendingDecision } {
  const decision = list.find((d) => d.id === id);
  if (!decision) throw new Error(`No pending decision ${id}. Parked: ${list.map((d) => d.id).join(', ') || 'none'}.`);
  return { list: list.filter((d) => d !== decision), decision };
}

export type WakeCardQuestion = PendingDecision & { waiting_items: number };
export type WakeBatch = { total: number; blocked_items: number[]; cards: WakeCardQuestion[][] };

/**
 * The wake-up round: every parked decision, the most-blocking first (oldest first on a tie), in
 * cards of at most four questions — one AskUserQuestion call (or one decision-card set) per card.
 */
export function wakeBatch(list: PendingDecision[]): WakeBatch {
  const sorted = list
    .map((d, i) => ({ d, i }))
    .sort(
      (a, b) =>
        b.d.blocks.length - a.d.blocks.length || a.d.created_at.localeCompare(b.d.created_at) || a.i - b.i,
    )
    .map(({ d }) => ({ ...d, waiting_items: d.blocks.length }));
  const cards: WakeCardQuestion[][] = [];
  for (let i = 0; i < sorted.length; i += QUESTIONS_PER_CARD) cards.push(sorted.slice(i, i + QUESTIONS_PER_CARD));
  const blocked_items = [...new Set(list.flatMap((d) => d.blocks))].sort((a, b) => a - b);
  return { total: list.length, blocked_items, cards };
}

/**
 * Installs the list through the state write guard (snapshot, `.tmp`, validate, rename). The guard
 * refuses a collapse to zero, so answering the last parked decision archives the file instead.
 */
export function writePendingDecisions(campaignDir: string, list: PendingDecision[], allowShrink = false): void {
  const livePath = path.join(campaignDir, PENDING_DECISIONS_FILE);
  const archiveDir = path.join(campaignDir, 'archive');
  if (list.length === 0) {
    if (!fs.existsSync(livePath)) return;
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(livePath, path.join(archiveDir, `pending-decisions-${stamp}.json`));
    return;
  }
  const result = installStateFile({
    livePath,
    archiveDir,
    content: `${JSON.stringify({ decisions: list }, null, 2)}\n`,
    entityKey: PENDING_ENTITY_KEY,
    allowShrink,
  });
  if (!result.ok) throw new Error(`Refused to write ${livePath}: ${result.reason}`);
}
