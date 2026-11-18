import type { Manifest } from '../carry-staged-artifacts.ts';
import { collectDocCarry, dispatchGaps } from '../route-artifacts.ts';
import { resolveBudgetSettings } from './budget.ts';
import { isSleepMode, wakeBatch, type PendingDecision } from './pending-decisions.ts';
import type { DocCarry, PendingRow, RunPanel } from './types.ts';

// The status page's Run panel (route, sleep mode, coordination) and its "Decisions waiting for
// you" list. Pure: `campaign-status.ts` reads `run-context.json` and `pending-decisions.json`.

/** The Run panel's rows, always all four, in this order: the coverage contract names them. */
export const RUN_ROW_KEYS = ['Run route', 'Sleep mode', 'Coordination', 'Doc carry'] as const;

/** `pending-decisions.json` as read: its decisions, or why it could not be read. */
export type PendingRead = PendingDecision[] | { error: string };

/** One issue's promised routes and manifest; `done` issues count only when they have a manifest. */
export type DocCarryIssue = { issue: number; promised: string[]; manifest: Manifest | null; done?: boolean };

/** How many issues with a gap the Doc carry row names before `+N more`. */
const DOC_CARRY_GAPS_SHOWN = 3;

/** Artifacts promised vs staged vs carried across the campaign; null when docs governance is off. */
export function buildDocCarry(input: { enabled: boolean; issues: DocCarryIssue[]; isCarried: (targetPath: string) => boolean }): DocCarry | null {
  if (!input.enabled) return null;
  const out: DocCarry = { promised: 0, staged: 0, carried: 0, gaps: [] };
  for (const i of input.issues) {
    if (i.done && !i.manifest) continue;
    const staged = i.promised.length - dispatchGaps(i.promised, i.manifest).length;
    out.promised += i.promised.length;
    out.staged += staged;
    out.carried += collectDocCarry(i.manifest, input.isCarried).carried;
    if (staged < i.promised.length) out.gaps.push({ issue: i.issue, staged, promised: i.promised.length });
  }
  return out;
}

/** `buildDocCarry`'s result, why it could not be read, or null/absent when docs governance is off. */
export type DocCarryRead = DocCarry | { error: string } | null;

const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function readRoute(runContext: unknown): RunPanel['route'] {
  const file = record(runContext);
  const route = record(file?.route);
  if (!route || typeof route.pattern !== 'string') return null;
  const host = record(record(file?.context)?.host);
  return {
    host: str(host?.value),
    pattern: route.pattern,
    state_store: str(route.state_store),
    question_channel: str(route.question_channel),
    forge_channel: str(route.forge_channel),
    missing: Array.isArray(route.missing) ? route.missing.filter((m): m is string => typeof m === 'string') : [],
    refreshed_at: str(file?.refreshed_at),
  };
}

export function buildRunPanel(input: { config: Record<string, unknown>; runContext: unknown; pending: PendingRead; docCarry?: DocCarryRead }): RunPanel {
  const settings = resolveBudgetSettings(input.config);
  const unreadable = !Array.isArray(input.pending);
  const dc = input.docCarry ?? null;
  const dcError = dc !== null && 'error' in dc ? dc.error : null;
  return {
    route: readRoute(input.runContext),
    sleep_mode: isSleepMode(input.config),
    parked: Array.isArray(input.pending) ? input.pending.length : null,
    parked_error: unreadable ? (input.pending as { error: string }).error : null,
    coordination: settings.budget ? { ...settings.budget.coordination } : null,
    coordination_invalid: settings.invalid,
    doc_carry: dc !== null && !dcError ? (dc as DocCarry) : null,
    doc_carry_error: dcError,
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function routeValue(r: RunPanel['route']): string {
  if (!r) return 'not recorded (bun run scripts/run-context.ts writes it)';
  const parts = [`pattern ${r.pattern}`, `host ${r.host ?? 'unknown'}`, `state ${r.state_store ?? 'unknown'}`, `questions ${r.question_channel ?? 'unknown'}`, `forge ${r.forge_channel ?? 'none'}`];
  if (r.missing.length) parts.push(`missing ${r.missing.join(', ')}`);
  return parts.join(' · ');
}

function coordinationValue(p: RunPanel): string {
  const c = p.coordination;
  if (!c) return `unknown — usage_budget invalid: ${p.coordination_invalid ?? 'no reason recorded'}`;
  if (c.role === 'manager') return 'manager · grants worker slots to its peer sessions';
  if (c.role === 'peer') return `peer of ${c.manager_session} · ${plural(c.peer_floor, 'worker')} before a grant`;
  return 'solo';
}

function docCarryValue(p: RunPanel): string {
  if (p.doc_carry_error) return `unreadable (${p.doc_carry_error})`;
  const d = p.doc_carry;
  if (!d) return 'off (docs governance off)';
  const base = `promised ${d.promised} · staged ${d.staged} · carried ${d.carried}`;
  if (d.gaps.length === 0) return base;
  const shown = d.gaps.slice(0, DOC_CARRY_GAPS_SHOWN).map((g) => `#${g.issue} ${g.staged}/${g.promised}`).join(', ');
  const more = d.gaps.length - DOC_CARRY_GAPS_SHOWN;
  return `${base} · gaps: ${shown}${more > 0 ? ` +${more} more` : ''}`;
}

/** The panel as key/value rows: the text dashboard, `--html` and the `run` dataset all print these. */
export function runRows(p: RunPanel): Array<{ key: string; value: string }> {
  const parked = p.parked === null ? `parked decisions unreadable: ${p.parked_error}` : plural(p.parked, 'parked decision');
  const values: Record<(typeof RUN_ROW_KEYS)[number], string> = {
    'Run route': routeValue(p.route),
    'Sleep mode': `${p.sleep_mode ? 'on' : 'off'} · ${parked}`,
    Coordination: coordinationValue(p),
    'Doc carry': docCarryValue(p),
  };
  return RUN_ROW_KEYS.map((key) => ({ key, value: values[key] }));
}

/** The parked decisions in the wake-up round's order (`wakeBatch`); none when the file is unreadable. */
export function pendingRows(pending: PendingRead): PendingRow[] {
  if (!Array.isArray(pending)) return [];
  return wakeBatch(pending).cards.flat().map((d) => ({
    id: d.id,
    question: d.question,
    recommended: d.options[d.recommended]?.label ?? '',
    waiting_items: d.waiting_items,
    gate: d.gate ?? null,
    created_at: d.created_at,
  }));
}
