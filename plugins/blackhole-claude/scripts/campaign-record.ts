import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';
import {
  addDecision,
  addScopeEntry,
  DECISIONS_FILE,
  isIsoDate,
  readDecisions,
  readScopeEntries,
  writeJsonAtomic,
} from './lib/campaign-status/record.ts';
import {
  addPendingDecision,
  askOrPark,
  readPendingDecisions,
  resolvePendingDecision,
  wakeBatch,
  writePendingDecisions,
  type PendingOption,
} from './lib/campaign-status/pending-decisions.ts';
import { SCOPE_KINDS, type QueueIssue, type ScopeEntry, type ScopeKind } from './lib/campaign-status/types.ts';
import { readBudgetPanel, when } from './lib/campaign-status/budget.ts';
import { buildWakeReport, doneIssues, planWakeUps, readSleepSession, sleepOff, sleepOn } from './lib/campaign-status/sleep-session.ts';
import { releaseHold, resolveStateStore, systemHoldDeps, takeHold, type HoldDeps } from './lib/campaign-status/sleep-hold.ts';
import { resolveHost } from './lib/usage-source.ts';
import { resolveUsageBudget } from './lib/usage-budget.ts';

// Records what the owner said so the status page shows it without a hand-kept file
// (`status-page.md` § What the orchestrator records), and the questions sleep mode parks for the
// owner's return (`sleep-mode.md`):
//
//   scope    --kind <in|parked|deferred|blocked-upstream|out> --text "<what>" [--reason "<why>"]
//            [--refs 12,14] [--filter] [--date YYYY-MM-DD]       → config.json campaign_scope.entries
//   decision --text "<one line>" [--refs 12] [--date YYYY-MM-DD] → owner-decisions.json
//   park     --question "<q>" --options "A: why|B|C" --recommended A [--evidence "<text>"]
//            [--refs 12,14] [--gate <name>]                      → pending-decisions.json
//   ask                                                          → prints `ask` or `park` (askOrPark)
//   sleep    --on | --off                                        → config.json sleep_mode (on records since + baseline);
//                                                                  on takes the local keep-awake hold, off releases it (sleep-hold.json)
//   wake                                                         → turns sleep mode off and releases the hold, then prints the report and the batched round as JSON
//   rearm                                                        → prints the wake-ups to keep armed as JSON (sleep-mode.md § Keeps itself alive)
//   resolve  --id PD-1 --answer "<text>" [--date YYYY-MM-DD]     → pending-decisions.json + owner-decisions.json
//
// All take --campaign-dir (default ./.blackhole). Re-running scope, decision or park changes nothing.

const USAGE =
  'Usage: bun scripts/campaign-record.ts scope --kind <in|parked|deferred|blocked-upstream|out> --text <text> ' +
  '[--reason <text>] [--refs 1,2] [--filter] [--date YYYY-MM-DD] | decision --text <text> [--refs 1,2] [--date YYYY-MM-DD] ' +
  '| park --question <text> --options "A: consequence|B" --recommended <label> [--evidence <text>] [--refs 1,2] [--gate <name>] ' +
  '| ask | sleep --on|--off | wake | rearm | resolve --id PD-<n> --answer <text> [--date YYYY-MM-DD] [--campaign-dir <dir>]';

type Flags = {
  kind?: string; text?: string; reason?: string; refs?: string; date?: string; filter: boolean; on: boolean; off: boolean; campaignDir: string;
  question?: string; options?: string; recommended?: string; evidence?: string; gate?: string; id?: string; answer?: string;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { filter: false, on: false, off: false, campaignDir: path.join(process.cwd(), '.blackhole') };
  const valued: Record<string, keyof Flags> = {
    '--kind': 'kind', '--text': 'text', '--reason': 'reason', '--refs': 'refs', '--date': 'date', '--campaign-dir': 'campaignDir',
    '--question': 'question', '--options': 'options', '--recommended': 'recommended', '--evidence': 'evidence',
    '--gate': 'gate', '--id': 'id', '--answer': 'answer',
  };
  for (let i = 0; i < argv.length; i++) {
    const key = valued[argv[i]];
    if (key) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${argv[i]} needs a value. ${USAGE}`);
      (flags as Record<string, unknown>)[key] = key === 'campaignDir' ? path.resolve(value) : value;
      i++;
    } else if (argv[i] === '--filter' || argv[i] === '--on' || argv[i] === '--off') {
      flags[argv[i].slice(2) as 'filter' | 'on' | 'off'] = true;
    } else {
      throw new Error(`Unknown argument "${argv[i]}". ${USAGE}`);
    }
  }
  return flags;
}

function parseRefs(refs: string | undefined): number[] | undefined {
  if (refs === undefined) return undefined;
  const out = refs.split(',').map((r) => r.trim().replace(/^#/, ''));
  if (out.some((r) => !/^\d+$/.test(r) || Number(r) <= 0)) throw new Error(`--refs takes issue or PR numbers, e.g. 12,14. ${USAGE}`);
  return [...new Set(out.map(Number))];
}

function requireText(text: string | undefined, flag = '--text'): string {
  const t = (text ?? '').trim();
  if (!t) throw new Error(`${flag} is required. ${USAGE}`);
  if (t.includes('\n')) throw new Error(`${flag} is one line.`);
  return t;
}

/** `"A: consequence|B"` → options; the label is the text before the first ": ". */
function parseOptions(raw: string | undefined): PendingOption[] {
  return requireText(raw, '--options').split('|').map((o) => {
    const at = o.indexOf(': ');
    const label = (at < 0 ? o : o.slice(0, at)).trim();
    const consequence = at < 0 ? '' : o.slice(at + 2).trim();
    return consequence ? { label, consequence } : { label };
  });
}

const today = (now: Date): string => now.toISOString().slice(0, 10);

function dateOf(flags: Flags, now: Date): string {
  const d = flags.date ?? today(now);
  if (!isIsoDate(d)) throw new Error(`--date must be YYYY-MM-DD, got "${d}".`);
  return d;
}

function readConfig(campaignDir: string): Record<string, unknown> & { sleep_mode?: Record<string, unknown> } {
  const configPath = path.join(campaignDir, 'config.json');
  if (!fs.existsSync(configPath)) throw new Error(`${configPath} is absent: the launch configuration gate writes it first.`);
  return readJsonFile(configPath, configPath) as Record<string, unknown> & { sleep_mode?: Record<string, unknown> };
}

function readOptionalJson(file: string): unknown {
  return fs.existsSync(file) ? readJsonFile(file, file) : null;
}

/** `queue.json`'s issues, or null when there is no queue yet. */
function readQueueIssues(campaignDir: string): Record<string, QueueIssue> | null {
  const queue = readOptionalJson(path.join(campaignDir, 'queue.json')) as { issues?: Record<string, QueueIssue> } | null;
  return queue?.issues ?? null;
}

/** The status page's budget panel for this host, now. */
const readBudget = (campaignDir: string, config: Record<string, unknown>, now: Date) =>
  readBudgetPanel(config, resolveHost(campaignDir, process.env), Math.floor(now.getTime() / 1000));

/** `usage_budget.coordination.role`; an invalid block counts as solo, so no peer is woken on a guess. */
function coordinationRole(config: Record<string, unknown>): string {
  try {
    return resolveUsageBudget(config).coordination.role;
  } catch {
    return 'solo';
  }
}

/**
 * Runs one record command and returns the line to print. Throws on bad input; writes nothing then.
 * `hold` makes the keep-awake inhibitor's process calls (`sleep-hold.ts`); tests pass a fake.
 */
export function runRecord(argv: string[], now: Date = new Date(), hold: HoldDeps = systemHoldDeps): string {
  const [sub, ...rest] = argv;
  const flags = parseFlags(rest);
  if (!fs.existsSync(flags.campaignDir)) throw new Error(`No campaign found at ${flags.campaignDir}.`);

  if (sub === 'scope') {
    const kind = (flags.kind ?? '').replace(/-/g, '_');
    if (!(SCOPE_KINDS as readonly string[]).includes(kind)) throw new Error(`--kind must be one of ${SCOPE_KINDS.join(', ').replace(/_/g, '-')}. ${USAGE}`);
    const entry: ScopeEntry = { kind: kind as ScopeKind, text: requireText(flags.text), set_at: dateOf(flags, now) };
    if (flags.reason?.trim()) entry.reason = flags.reason.trim();
    const refs = parseRefs(flags.refs);
    if (refs) entry.refs = refs;
    if (flags.filter) {
      if (entry.kind !== 'in') throw new Error('--filter describes the issue filter, so it goes with --kind in.');
      entry.filter = true;
    }
    const configPath = path.join(flags.campaignDir, 'config.json');
    if (!fs.existsSync(configPath)) throw new Error(`${configPath} is absent: the launch configuration gate writes it first.`);
    const config = readJsonFile(configPath, configPath) as Record<string, unknown> & { campaign_scope?: { entries?: unknown } };
    const entries = addScopeEntry(readScopeEntries(config), entry);
    writeJsonAtomic(configPath, { ...config, campaign_scope: { ...(config.campaign_scope ?? {}), entries } });
    return `Scope: ${entry.kind.replace(/_/g, ' ')} — ${entry.text} (${entries.length} entries)`;
  }

  if (sub === 'decision') {
    if (flags.kind || flags.reason || flags.filter) throw new Error(`decision takes --text, --refs and --date only. ${USAGE}`);
    const refs = parseRefs(flags.refs);
    const decision = { date: dateOf(flags, now), text: requireText(flags.text), ...(refs ? { refs } : {}) };
    const file = path.join(flags.campaignDir, DECISIONS_FILE);
    const decisions = addDecision(readDecisions(flags.campaignDir, true), decision);
    writeJsonAtomic(file, { decisions });
    return `Decision ${decision.date}: ${decision.text} (${decisions.length} recorded)`;
  }

  if (sub === 'park') {
    const options = parseOptions(flags.options);
    const recommended = options.findIndex((o) => o.label === flags.recommended?.trim());
    if (recommended < 0) throw new Error(`--recommended must name one of the options (${options.map((o) => o.label).join(', ')}).`);
    const before = readPendingDecisions(flags.campaignDir);
    const { file, decision } = addPendingDecision(before, {
      question: requireText(flags.question, '--question'),
      options,
      recommended,
      ...(flags.evidence?.trim() ? { evidence: flags.evidence.trim() } : {}),
      blocks: parseRefs(flags.refs) ?? [],
      ...(flags.gate?.trim() ? { gate: flags.gate.trim() } : {}),
      created_at: now.toISOString(),
    });
    writePendingDecisions(flags.campaignDir, file);
    const blocks = decision.blocks.length ? `blocks ${decision.blocks.map((b) => `#${b}`).join(', ')}` : 'blocks nothing';
    return `Parked ${decision.id}: ${decision.question} (${blocks}; ${file.decisions.length} waiting)`;
  }

  if (sub === 'ask') return askOrPark(readConfig(flags.campaignDir));

  if (sub === 'sleep') {
    if (flags.on === flags.off) throw new Error(`sleep takes --on or --off. ${USAGE}`);
    const configPath = path.join(flags.campaignDir, 'config.json');
    const config = readConfig(flags.campaignDir);
    const waiting = readPendingDecisions(flags.campaignDir).decisions.length;
    if (flags.off) {
      writeJsonAtomic(configPath, sleepOff(config));
      const released = releaseHold(flags.campaignDir, hold);
      return `Sleep mode off: ${waiting} parked decision${waiting === 1 ? '' : 's'} wait for \`campaign-record.ts wake\`.\n${released}`;
    }
    const issues = readQueueIssues(flags.campaignDir);
    const baseline = { done: issues ? doneIssues(issues) : null, weekly_pct: readBudget(flags.campaignDir, config, now).weekly_pct };
    const next = sleepOn(config, now.toISOString(), baseline);
    writeJsonAtomic(configPath, next);
    const held = takeHold(flags.campaignDir, resolveStateStore(flags.campaignDir, process.env), hold, now.toISOString());
    return `Sleep mode on since ${when(readSleepSession(next).since ?? now.toISOString())}: owner questions are parked (${waiting} waiting).\n${held}`;
  }

  if (sub === 'wake') {
    // Sleep mode goes off before the round is printed: while it is on, every question — the
    // round's own included — would be parked again (`clarify-gates.md` § C3 adapter).
    const config = readConfig(flags.campaignDir);
    writeJsonAtomic(path.join(flags.campaignDir, 'config.json'), sleepOff(config));
    const keep_awake = releaseHold(flags.campaignDir, hold);
    const batch = wakeBatch(readPendingDecisions(flags.campaignDir).decisions);
    const report = buildWakeReport({
      ...readSleepSession(config),
      issues: readQueueIssues(flags.campaignDir),
      budget: readBudget(flags.campaignDir, config, now),
      pending: batch.total,
    });
    return JSON.stringify({ report, keep_awake, ...batch }, null, 2);
  }

  if (sub === 'rearm') {
    const config = readConfig(flags.campaignDir);
    const runContext = readOptionalJson(path.join(flags.campaignDir, 'run-context.json')) as { route?: { schedule?: unknown } } | null;
    const wake_ups = planWakeUps({
      budget: readBudget(flags.campaignDir, config, now),
      issues: readQueueIssues(flags.campaignDir) ?? {},
      role: coordinationRole(config),
      nowIso: now.toISOString(),
    });
    return JSON.stringify({ schedule: runContext?.route?.schedule === 'routine' ? 'routine' : 'turn', wake_ups }, null, 2);
  }

  if (sub === 'resolve') {
    const answer = requireText(flags.answer, '--answer');
    const { file, decision } = resolvePendingDecision(readPendingDecisions(flags.campaignDir), requireText(flags.id, '--id'));
    const record = {
      date: dateOf(flags, now),
      text: `${decision.question} → ${answer}`,
      ...(decision.blocks.length ? { refs: decision.blocks } : {}),
    };
    const decisions = addDecision(readDecisions(flags.campaignDir, true), record);
    writeJsonAtomic(path.join(flags.campaignDir, DECISIONS_FILE), { decisions });
    writePendingDecisions(flags.campaignDir, file, true);
    const unblock = decision.blocks.length ? `Unblock ${decision.blocks.map((b) => `#${b}`).join(', ')}` : 'Nothing to unblock';
    return `Resolved ${decision.id} → ${answer}. ${unblock} (${file.decisions.length} still pending)`;
  }

  throw new Error(`Unknown subcommand "${sub ?? ''}". ${USAGE}`);
}

if (import.meta.main) {
  try {
    console.log(runRecord(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
