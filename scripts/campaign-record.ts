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
import { SCOPE_KINDS, type ScopeEntry, type ScopeKind } from './lib/campaign-status/types.ts';

// Records what the owner said so the status page shows it without a hand-kept file
// (`status-page.md` § What the orchestrator records). Two subcommands:
//
//   scope    --kind <in|parked|deferred|blocked-upstream|out> --text "<what>" [--reason "<why>"]
//            [--refs 12,14] [--filter] [--date YYYY-MM-DD]       → config.json campaign_scope.entries
//   decision --text "<one line>" [--refs 12] [--date YYYY-MM-DD] → owner-decisions.json
//
// Both take --campaign-dir (default ./.blackhole). Re-running the same command changes nothing.

const USAGE =
  'Usage: bun scripts/campaign-record.ts scope --kind <in|parked|deferred|blocked-upstream|out> --text <text> ' +
  '[--reason <text>] [--refs 1,2] [--filter] [--date YYYY-MM-DD] | decision --text <text> [--refs 1,2] [--date YYYY-MM-DD] ' +
  '[--campaign-dir <dir>]';

type Flags = { kind?: string; text?: string; reason?: string; refs?: string; date?: string; filter: boolean; campaignDir: string };

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { filter: false, campaignDir: path.join(process.cwd(), '.blackhole') };
  const valued: Record<string, keyof Flags> = {
    '--kind': 'kind', '--text': 'text', '--reason': 'reason', '--refs': 'refs', '--date': 'date', '--campaign-dir': 'campaignDir',
  };
  for (let i = 0; i < argv.length; i++) {
    const key = valued[argv[i]];
    if (key) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${argv[i]} needs a value. ${USAGE}`);
      (flags as Record<string, unknown>)[key] = key === 'campaignDir' ? path.resolve(value) : value;
      i++;
    } else if (argv[i] === '--filter') {
      flags.filter = true;
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

function requireText(text: string | undefined): string {
  const t = (text ?? '').trim();
  if (!t) throw new Error(`--text is required. ${USAGE}`);
  if (t.includes('\n')) throw new Error('--text is one line.');
  return t;
}

const today = (now: Date): string => now.toISOString().slice(0, 10);

function dateOf(flags: Flags, now: Date): string {
  const d = flags.date ?? today(now);
  if (!isIsoDate(d)) throw new Error(`--date must be YYYY-MM-DD, got "${d}".`);
  return d;
}

/** Runs one record command and returns the line to print. Throws on bad input; writes nothing then. */
export function runRecord(argv: string[], now: Date = new Date()): string {
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
