import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from '../fs.ts';
import { SCOPE_KINDS, type OwnerDecision, type ScopeEntry, type ScopeKind } from './types.ts';

// The two owner-written records the status page shows: the campaign scope (`config.json` →
// `campaign_scope.entries`) and the owner's decisions (`owner-decisions.json`). Both are written only
// through `scripts/campaign-record.ts`, so their shape is checked once, here.

export const DECISIONS_FILE = 'owner-decisions.json';

/** The word every renderer shows for each scope kind, in the order the Scope section lists them. */
export const SCOPE_LABELS: Record<ScopeKind, string> = {
  in: 'In',
  parked: 'Parked',
  deferred: 'Deferred',
  blocked_upstream: 'Blocked upstream',
  out: 'Out',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isScopeKind = (v: unknown): v is ScopeKind => (SCOPE_KINDS as readonly string[]).includes(String(v));

const cleanRefs = (refs: unknown): number[] | undefined => {
  if (!Array.isArray(refs)) return undefined;
  const out = [...new Set(refs.filter((r): r is number => Number.isInteger(r) && r > 0))];
  return out.length ? out : undefined;
};

/** The valid entries of a recorded scope, in recorded order. Anything malformed is skipped, never guessed. */
export function readScopeEntries(config: { campaign_scope?: { entries?: unknown } }): ScopeEntry[] {
  const raw = config.campaign_scope?.entries;
  if (!Array.isArray(raw)) return [];
  const out: ScopeEntry[] = [];
  for (const e of raw as Array<Record<string, unknown>>) {
    if (!e || !isScopeKind(e.kind) || typeof e.text !== 'string' || !e.text.trim()) continue;
    if (typeof e.set_at !== 'string' || !DATE.test(e.set_at)) continue;
    const entry: ScopeEntry = { kind: e.kind, text: e.text.trim(), set_at: e.set_at };
    if (typeof e.reason === 'string' && e.reason.trim()) entry.reason = e.reason.trim();
    const refs = cleanRefs(e.refs);
    if (refs) entry.refs = refs;
    if (e.filter === true) entry.filter = true;
    out.push(entry);
  }
  return out;
}

/**
 * Adds one entry so the record always says what holds now. A `filter` entry (the launch gate's
 * description of the issue filter) replaces the previous one. An entry naming `refs` takes those refs
 * from every older entry, and an older entry left with no refs is dropped: re-including a parked
 * issue moves it, it does not list it twice. An entry identical to one already recorded (date aside)
 * returns `entries` unchanged, so re-running a command neither moves nor re-dates it; that check runs
 * on the original entries, before the passes above would strip the twin's refs or replace its filter.
 */
export function addScopeEntry(entries: ScopeEntry[], next: ScopeEntry): ScopeEntry[] {
  const same = (e: ScopeEntry) =>
    e.kind === next.kind && e.text === next.text && (e.reason ?? '') === (next.reason ?? '') &&
    Boolean(e.filter) === Boolean(next.filter) &&
    JSON.stringify(e.refs ?? []) === JSON.stringify(next.refs ?? []);
  if (entries.some(same)) return entries;
  const taken = new Set(next.refs ?? []);
  const kept = entries
    .filter((e) => !(next.filter && e.filter))
    .map((e) => (e.refs && taken.size ? { ...e, refs: e.refs.filter((r) => !taken.has(r)) } : e))
    .filter((e) => !e.refs || e.refs.length > 0);
  return [...kept, next];
}

/** The latest scope entry naming `ref`, or null. */
export function scopeEntryFor(entries: ScopeEntry[], ref: number | null): ScopeEntry | null {
  if (ref == null) return null;
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].refs?.includes(ref)) return entries[i];
  return null;
}

/**
 * The decisions of `owner-decisions.json` in recorded order; absent ⇒ none. A malformed file reads as
 * none for the page, and throws when `strict` (the writer), so an append never replaces a file it
 * could not read.
 */
export function readDecisions(campaignDir: string, strict = false): OwnerDecision[] {
  const file = path.join(campaignDir, DECISIONS_FILE);
  if (!fs.existsSync(file)) return [];
  const refuse = (why: string): OwnerDecision[] => {
    if (strict) throw new Error(`${file} ${why}; fix it before recording a decision.`);
    return [];
  };
  let raw: unknown;
  try {
    raw = readJsonFile(file, file);
  } catch {
    return refuse('is not valid JSON');
  }
  const list = (raw as { decisions?: unknown })?.decisions;
  if (!Array.isArray(list)) return refuse('has no "decisions" array');
  return list.flatMap((d: Record<string, unknown>) => {
    if (!d || typeof d.text !== 'string' || !d.text.trim() || typeof d.date !== 'string' || !DATE.test(d.date)) return [];
    const out: OwnerDecision = { date: d.date, text: d.text.trim() };
    const refs = cleanRefs(d.refs);
    if (refs) out.refs = refs;
    return [out];
  });
}

/** Appends a decision; the same text on the same date is recorded once. */
export function addDecision(decisions: OwnerDecision[], next: OwnerDecision): OwnerDecision[] {
  return decisions.some((d) => d.date === next.date && d.text === next.text) ? decisions : [...decisions, next];
}

/** Newest first; decisions of one date keep their reverse recorded order. */
export const newestFirst = (decisions: OwnerDecision[]): OwnerDecision[] =>
  decisions
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.date.localeCompare(a.d.date) || b.i - a.i)
    .map((x) => x.d);

/** Writes `<file>.tmp`, parses it back, then renames it over `file`. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(`${file}.tmp`, text);
  readJsonFile(`${file}.tmp`, `${file}.tmp`);
  fs.renameSync(`${file}.tmp`, file);
}

export const isIsoDate = (v: string): boolean => DATE.test(v) && !Number.isNaN(Date.parse(v));
