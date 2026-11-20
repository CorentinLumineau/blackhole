import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, withLinkedWorktree, writeCampaignConfig } from './lib/test-fixtures.ts';

// No new allows: the Bash write-target guard's verdict on every corpus command may only stay or
// grow in severity (allow < warn < block) against the committed baseline, which holds the verdicts
// of the guard on main when each row was recorded. A row may relax only when it is listed in
// `intentional_relaxations` with a reason and a `same_as` command that the shell runs identically
// (the row without one redirect main misread, which the test checks): the relaxed row is then
// held to that command's baseline instead. A loosened row is never fixed by editing its baseline.
//
// The baseline is committed rather than read from `origin/main` because a CI checkout may not
// carry main's objects. To add rows for new corpus commands, run this file with
// GUARD_BASELINE_REF=origin/main: it records only the rows the baseline does not have yet.

const UTILS = path.join(PRETOOLUSE_HOOKS_DIR, 'utils');
const BASELINE_FILE = path.join(import.meta.dir, 'fixtures', 'hooks-write-guard-baseline-verdicts.json');

type Tier = 'allow' | 'warn' | 'block';
type Evaluate = (command: string, cwd: string) => { tier: string } | null;
type Baseline = {
  recorded_from: string[];
  intentional_relaxations: Array<{ command: string; same_as: string; reason: string }>;
  rows: Record<string, Tier>;
};

const RANK: Record<Tier, number> = { allow: 0, warn: 1, block: 2 };
const tierOf = (verdict: { tier: string } | null): Tier => (verdict === null ? 'allow' : (verdict.tier as Tier));

// Corpus commands name fixture paths through placeholders, since each fixture lives in a fresh
// temporary directory.
const DESTINATIONS = [
  '@STATE@/config.json',
  '@STATE@/hook-events/e.json',
  '@STATE@/staged/1/f.json',
  '@MAIN@/.claude/settings.json',
  '/etc/x',
  './y',
  '@WT@/z',
  'sub/w',
];

const spellings = (d: string) => {
  const i = d.lastIndexOf('/') + 1;
  return [
    d,
    `'${d.slice(0, i)}'${d.slice(i)}`,
    `"${d.slice(0, i)}"${d.slice(i)}`,
    `"${d}"`,
    `'${d.slice(0, i)}'"${d.slice(i)}"`,
    `'${d}`,
    `"${d}`,
  ];
};

const TEMPLATES: Array<(d: string) => string> = [
  (d) => `cp x ${d}`,
  (d) => `cp x ${d} 2>/dev/null`,
  (d) => `cp x 2>/dev/null ${d}`,
  (d) => `cp x ${d} 2>&1`,
  (d) => `cp x ${d} &>/dev/null`,
  (d) => `install x ${d} -m 644`,
  (d) => `install -m 644 x ${d}`,
  (d) => `install x ${d} --owner root`,
  (d) => `install x ${d} --mode=644 2>&1`,
  (d) => `cp x ${d} -S .bak`,
  (d) => `cp x ${d} -f`,
  (d) => `cp x ${d} --strange-option value`,
  (d) => `cp -t ${d} x`,
  (d) => `cp x -t ${d}`,
  (d) => `mv x ${d} 2>&1`,
  (d) => `mv x ${d} -f`,
  (d) => `ln -s x ${d}`,
  (d) => `echo y > ${d}`,
  (d) => `echo y >> ${d} 2>&1`,
  (d) => `echo y | tee ${d}`,
  (d) => `echo y | tee -a ${d} 2>/dev/null`,
  (d) => `truncate -s 0 ${d}`,
  (d) => `rsync x ${d}`,
  (d) => `rsync x ${d} --exclude y`,
  (d) => `sed -i s/a/b/ ${d}`,
  (d) => `sort -o ${d} x`,
  (d) => `sort --output=${d} x`,
  (d) => `uniq x ${d}`,
  (d) => `yq -i . ${d}`,
  (d) => `dd if=x of=${d}`,
  // A redirect operator written apart from its word, after the destination.
  (d) => `cp x ${d} >| ./log`,
  (d) => `cp x ${d} >| /dev/null`,
  (d) => `cp x ${d} 2>| ./log`,
  (d) => `install x ${d} >| ./log`,
  (d) => `ln -sf x ${d} >| ./log`,
  (d) => `rsync x ${d} >| ./log`,
  (d) => `mv x ${d} >| ./log`,
  (d) => `cp x ${d} {fd}> ./log`,
  (d) => `cp x ${d} {fd}>> ./log`,
  (d) => `cp x ${d} {fd}>/dev/null`,
  (d) => `install x ${d} {fd}> ./log`,
  (d) => `cp x ${d} 3<> ./log`,
  (d) => `cp x ${d} < ./x`,
  (d) => `cp x ${d} <<- EOF\nhi\nEOF`,
  (d) => `cp x ${d} <<EOF\nhi\nEOF`,
  (d) => `cp x ${d} --remove-destination`,
  // A redirect operator glued to the destination, its word apart.
  (d) => `cp x ${d}> ./log`,
  (d) => `cp x ${d}>| ./log`,
  (d) => `cp x ${d}>> ./log`,
  (d) => `install x ${d}> ./log`,
  (d) => `ln -sf x ${d}> ./log`,
  (d) => `rsync x ${d}> ./log`,
  (d) => `cp x ${d}<< EOF\nhi\nEOF`,
  // The plan's must-DENY / must-ALLOW rows the forms above do not already spell.
  (d) => `install x ${d} 2>&1`,
  (d) => `install -m 644 x ${d} 2>/dev/null`,
  (d) => `install x ${d} --mode=644`,
  (d) => `install x ${d} -o root -g root`,
  (d) => `tee ${d} < x`,
  (d) => `cp /usr/share/doc/x ${d} 2>/dev/null`,
  // The GIT_TRACE scan reads the same redirect grammar.
  (d) => `env "GIT_TRACE=${d}" git status`,
  (d) => `env >| ./log "GIT_TRACE=${d}" git status`,
  (d) => `env 2>| ./log "GIT_TRACE=${d}" git status`,
  (d) => `env {fd}> ./log "GIT_TRACE=${d}" git status`,
];

const corpusFor = (dest: string) => spellings(dest).flatMap((spelled) => TEMPLATES.map((build) => build(spelled)));
const CORPUS = DESTINATIONS.flatMap(corpusFor);

/** Each spelling of `command` with one redirect removed, whether attached (`2>/dev/null`) or an
 * operator and its word (`{fd}> ./log`): the commands a relaxation's `same_as` may name. */
const withoutOneRedirectWord = (command: string) => {
  const words = command.split(' ');
  const drop = (k: number, n: number) => [...words.slice(0, k), ...words.slice(k + n)].join(' ');
  return words.flatMap((word, k) => {
    const redirect = /^(?:[0-9&]*|\{[A-Za-z_]\w*\})[<>]([<>|&-]*)(.*)$/.exec(word);
    if (!redirect) return [];
    return redirect[2] ? [drop(k, 1)] : [drop(k, 2)];
  });
};

const readBaseline = (): Baseline => JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));

type Fixture = { main: string; state: string; wt: string };

const withFixture = (fn: (fx: Fixture) => void | Promise<void>) =>
  withLinkedWorktree('blackhole-differential-', async (main, wt) => {
    writeCampaignConfig(main, { forge: 'github' });
    const realMain = fs.realpathSync(main);
    const state = path.join(realMain, '.blackhole');
    for (const sub of ['staged/1', 'hook-events']) fs.mkdirSync(path.join(state, sub), { recursive: true });
    fs.writeFileSync(path.join(wt, 'x'), 'x');
    await fn({ main: realMain, state, wt });
  });

const concrete = (command: string, fx: Fixture) =>
  command.replaceAll('@STATE@', fx.state).replaceAll('@MAIN@', fx.main).replaceAll('@WT@', fx.wt);

/** Corpus commands whose verdict under `evaluate` is less severe than their baseline row, or than
 * their `same_as` command's row when the row is an intentional relaxation. */
const looserRows = (commands: string[], baseline: Baseline, evaluate: Evaluate, fx: Fixture) => {
  const sameAs = new Map(baseline.intentional_relaxations.map((r) => [r.command, r.same_as]));
  const looser: string[] = [];
  for (const command of commands) {
    const before = baseline.rows[sameAs.get(command) ?? command];
    const after = tierOf(evaluate(concrete(command, fx), fx.wt));
    if (RANK[after] < RANK[before]) looser.push(`${JSON.stringify(command)}: baseline ${before}, now ${after}`);
  }
  return looser;
};

/** The guard as committed at `ref`, loaded in memory with its sibling modules from the same ref. */
const loadGuardAt = (ref: string) => {
  const cache = new Map<string, unknown>();
  const load = (name: string): unknown => {
    if (cache.has(name)) return cache.get(name);
    const source = execFileSync('git', ['show', `${ref}:templates/hooks/pretooluse/utils/${name}.js`], { encoding: 'utf-8' }).replace(/^#!.*\n/, '');
    const mod = { exports: {} as unknown };
    cache.set(name, mod.exports);
    const req = (id: string) => (id.startsWith('./') ? load(id.slice(2).replace(/\.js$/, '')) : require(id));
    new Function('require', 'module', 'exports', '__dirname', '__filename', source)(req, mod, mod.exports, UTILS, path.join(UTILS, `${name}.js`));
    cache.set(name, mod.exports);
    return mod.exports;
  };
  return load('bash-write-target-guard') as { evaluateBashWriteTargets: Evaluate };
};

const headGuard = () => require(path.join(UTILS, 'bash-write-target-guard.js')) as { evaluateBashWriteTargets: Evaluate };

// Recording mode only: never registered in an ordinary run.
const recordRef = process.env.GUARD_BASELINE_REF;
if (recordRef) {
  test(`record missing baseline rows from ${recordRef}`, async () => {
    const sha = execFileSync('git', ['rev-parse', recordRef], { encoding: 'utf-8' }).trim();
    const baseline: Baseline = fs.existsSync(BASELINE_FILE)
      ? readBaseline()
      : { recorded_from: [], intentional_relaxations: [], rows: {} };
    const guard = loadGuardAt(recordRef);
    let added = 0;
    await withFixture((fx) => {
      for (const command of CORPUS) {
        if (command in baseline.rows) continue;
        baseline.rows[command] = tierOf(guard.evaluateBashWriteTargets(concrete(command, fx), fx.wt));
        added++;
      }
    });
    if (added > 0 && !baseline.recorded_from.includes(sha)) baseline.recorded_from.push(sha);
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`baseline: ${added} rows recorded from ${sha}`);
  }, 600_000);
}

describe('Bash write guard verdicts never loosen against the baseline', () => {
  test('every corpus command has a baseline row and every relaxation is justified', () => {
    const baseline = readBaseline();
    expect(baseline.recorded_from.length).toBeGreaterThan(0);
    expect(CORPUS.filter((command) => !(command in baseline.rows))).toEqual([]);
    for (const relaxation of baseline.intentional_relaxations) {
      expect(baseline.rows[relaxation.command]).toBeDefined();
      expect(baseline.rows[relaxation.same_as]).toBeDefined();
      expect(withoutOneRedirectWord(relaxation.command)).toContain(relaxation.same_as);
      expect(relaxation.reason.trim().length).toBeGreaterThan(20);
    }
  });

  test('a guard that allows everything fails the comparison on every warned or denied row', async () => {
    const baseline = readBaseline();
    expect(CORPUS.some((command) => baseline.rows[command] !== 'allow')).toBe(true);
    await withFixture((fx) => {
      const sameAs = new Map(baseline.intentional_relaxations.map((r) => [r.command, r.same_as]));
      const held = CORPUS.filter((command) => baseline.rows[sameAs.get(command) ?? command] !== 'allow');
      expect(looserRows(CORPUS, baseline, () => null, fx).length).toBe(held.length);
    });
  });

  for (const dest of DESTINATIONS) {
    test(`head is never less severe than the baseline for ${dest}`, async () => {
      const baseline = readBaseline();
      await withFixture((fx) => {
        expect(looserRows(corpusFor(dest), baseline, headGuard().evaluateBashWriteTargets, fx)).toEqual([]);
      });
    }, 60_000);
  }
});
