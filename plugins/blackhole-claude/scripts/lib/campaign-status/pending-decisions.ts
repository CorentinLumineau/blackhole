import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { installStateFile } from '../state-write-guard.ts';

// Decision parking (`decision-parking.md`, ADR-059): every owner question the campaign raises is
// parked here by default, and `/blackhole decide` asks them all in one round. `.blackhole/pending-decisions.json`
// is written only through `scripts/campaign-record.ts park` and `resolve`, so its shape is checked once, here.

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

/**
 * The warning for a `sleep_mode` block left in `config.json` after sleep mode was retired (ADR-059
 * amendment), or null when there is none. The block is ignored, never an error: parking is the
 * default, the keep-awake hold follows the run, and an unattended start passes `--unattended`.
 */
export function retiredSleepModeWarning(config: unknown): string | null {
  if (typeof config !== 'object' || config === null || !Object.hasOwn(config, 'sleep_mode')) return null;
  return 'config.json sleep_mode is retired and ignored (ADR-059 amendment): remove it; an unattended start passes --unattended';
}

export type DecisionsMode = 'park' | 'ask';

/** The raw `decisions.mode` value, or undefined when the block or key is absent. */
export const rawDecisionsMode = (config: unknown): unknown =>
  ((config as { decisions?: unknown } | null)?.decisions as { mode?: unknown } | null | undefined)?.mode;

/**
 * `decisions.mode`: only an exact `"ask"` opts out of parking. Absent or anything else parks, since
 * parking never decides for the owner and never interrupts them. A retired `sleep_mode` block is
 * never read here (`retiredSleepModeWarning`).
 */
export function decisionsMode(config: unknown): DecisionsMode {
  return rawDecisionsMode(config) === 'ask' ? 'ask' : 'park';
}

/**
 * The one choke point every owner question the campaign raises goes through: ask now, or park it
 * for `/blackhole decide`. It follows `decisions.mode` alone.
 */
export function askOrPark(config: unknown): 'ask' | 'park' {
  return decisionsMode(config);
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
  const labels = options.map((o) => o.label.trim());
  if (new Set(labels).size !== labels.length) return `${r.id} has duplicate option labels`;
  const rec = r.recommended;
  if (typeof rec !== 'number' || !Number.isInteger(rec) || rec < 0 || rec >= options.length) {
    return `${r.id} recommends no listed option`;
  }
  if (!Array.isArray(r.blocks) || r.blocks.some((b) => !Number.isInteger(b) || b <= 0)) return `${r.id} has invalid blocks`;
  if (typeof r.created_at !== 'string' || Number.isNaN(Date.parse(r.created_at))) return `${r.id} has no created_at`;
  return null;
}

/**
 * The file's content: the parked decisions in recorded order, and the number the next one takes.
 * `next_id` only grows, even once every decision is answered, so an id is never reused and a late
 * answer can never resolve a different question.
 */
export type PendingFile = { next_id: number; decisions: PendingDecision[] };

const idNumber = (d: PendingDecision): number => Number(d.id.slice(3));

/** Absent ⇒ nothing parked yet. A malformed file throws: never guess. */
export function readPendingDecisions(campaignDir: string): PendingFile {
  const file = path.join(campaignDir, PENDING_DECISIONS_FILE);
  if (!fs.existsSync(file)) return { next_id: 1, decisions: [] };
  const raw = readJsonFile(file, file) as { decisions?: unknown; next_id?: unknown };
  const list = raw?.decisions;
  if (!Array.isArray(list)) throw new Error(`${file} has no "decisions" array; fix it before parking or resolving.`);
  for (const d of list) {
    const why = pendingDecisionError(d);
    if (why) throw new Error(`${file}: a decision ${why}.`);
  }
  const decisions = list as PendingDecision[];
  const floor = decisions.reduce((max, d) => Math.max(max, idNumber(d)), 0) + 1;
  const recorded = Number.isInteger(raw.next_id) ? (raw.next_id as number) : 0;
  return { next_id: Math.max(recorded, floor), decisions };
}

const sameOptions = (a: PendingOption[], b: PendingOption[]): boolean =>
  a.length === b.length && a.every((o, i) => o.label === b[i].label && (o.consequence ?? '') === (b[i].consequence ?? ''));

/**
 * Parks one decision. The same question parked again with the same options is not listed twice:
 * it gains the new `blocks` and keeps its id and date, so the cost of waiting stays honest. The
 * same question with different options is refused: silently keeping either set would ask the owner
 * something other than what one of the parking gates meant.
 */
export function addPendingDecision(
  file: PendingFile,
  next: Omit<PendingDecision, 'id'>,
): { file: PendingFile; decision: PendingDecision } {
  const twin = file.decisions.find((d) => d.question === next.question);
  if (twin) {
    if (!sameOptions(twin.options, next.options)) {
      throw new Error(
        `${twin.id} already parks "${twin.question}" with options ${twin.options.map((o) => o.label).join(', ')}; ` +
          'park it again with the same options, or reword the question.',
      );
    }
    const merged = { ...twin, blocks: [...new Set([...twin.blocks, ...next.blocks])] };
    return { file: { ...file, decisions: file.decisions.map((d) => (d === twin ? merged : d)) }, decision: merged };
  }
  const decision: PendingDecision = { id: `PD-${file.next_id}`, ...next };
  const why = pendingDecisionError(decision);
  if (why) throw new Error(`The decision ${why}.`);
  return { file: { next_id: file.next_id + 1, decisions: [...file.decisions, decision] }, decision };
}

/** Removes the answered decision; throws when `id` is not parked. `next_id` is kept. */
export function resolvePendingDecision(file: PendingFile, id: string): { file: PendingFile; decision: PendingDecision } {
  const decision = file.decisions.find((d) => d.id === id);
  if (!decision) {
    throw new Error(`No pending decision ${id}. Parked: ${file.decisions.map((d) => d.id).join(', ') || 'none'}.`);
  }
  return { file: { ...file, decisions: file.decisions.filter((d) => d !== decision) }, decision };
}

export type WakeCardQuestion = PendingDecision & { waiting_items: number };
export type WakeBatch = { total: number; blocked_items: number[]; cards: WakeCardQuestion[][] };

/**
 * The decision round (`decide`, and `wake` after it ends the absence): every parked decision, the most-blocking first (oldest first on a tie), in
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
 * Installs the file through the state write guard (snapshot, `.tmp`, validate, rename). The guard
 * refuses a collapse to zero, so answering the last parked decision snapshots the file into
 * `archive/` and then writes the empty list with its `next_id` directly.
 */
export function writePendingDecisions(campaignDir: string, file: PendingFile, allowShrink = false): void {
  const livePath = path.join(campaignDir, PENDING_DECISIONS_FILE);
  const archiveDir = path.join(campaignDir, 'archive');
  const content = `${JSON.stringify(file, null, 2)}\n`;
  if (file.decisions.length === 0) {
    if (fs.existsSync(livePath)) {
      fs.mkdirSync(archiveDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(livePath, path.join(archiveDir, `pending-decisions-${stamp}.json`));
    }
    fs.writeFileSync(`${livePath}.tmp`, content);
    fs.renameSync(`${livePath}.tmp`, livePath);
    return;
  }
  const result = installStateFile({ livePath, archiveDir, content, entityKey: PENDING_ENTITY_KEY, allowShrink });
  if (!result.ok) throw new Error(`Refused to write ${livePath}: ${result.reason}`);
}
