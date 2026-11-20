import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, withLinkedWorktree, writeCampaignConfig } from './lib/test-fixtures.ts';

// A redirect word among the operands of cp/install/mv, an option after the destination, and a
// destination spelled with adjacent quote segments must each reach the containment check on the
// path the shell writes, or a worker reaches the campaign state dir (config.json, hook-events/)
// through a form the parser read differently.

const UTILS = path.join(PRETOOLUSE_HOOKS_DIR, 'utils');
const guardOf = (dir: string) => require(path.join(dir, 'bash-write-target-guard.js'));

type Verdict = { tier: string; pattern_id: string } | null;

const withState = async (fn: (state: string, wt: string, run: (command: string) => Verdict) => void | Promise<void>) =>
  withLinkedWorktree('blackhole-operands-', async (main, wt) => {
    writeCampaignConfig(main, { forge: 'github' });
    const state = path.join(fs.realpathSync(main), '.blackhole');
    for (const sub of ['staged/1', 'hook-events']) fs.mkdirSync(path.join(state, sub), { recursive: true });
    fs.writeFileSync(path.join(wt, 'x'), 'x');
    await fn(state, wt, (command) => guardOf(UTILS).evaluateBashWriteTargets(command, wt));
  });

const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
const SETTINGS_BLOCK = { tier: 'block', pattern_id: 'bash-settings-roots-write' };

/** The main clone's own Claude Code settings file, which lists the roots workers may write. */
const settingsOf = (state: string) => path.join(path.dirname(state), '.claude', 'settings.json');

const DESTINATIONS = (state: string) => [
  `${state}/config.json`,
  `${state}/hook-events/e.json`,
  '/etc/x',
];

describe('a redirect word among cp/install/mv operands', () => {
  const forms: Array<[string, (d: string) => string]> = [
    ['cp x D 2>/dev/null', (d) => `cp x ${d} 2>/dev/null`],
    ['install x D 2>&1', (d) => `install x ${d} 2>&1`],
    ['cp x 2>/dev/null D', (d) => `cp x 2>/dev/null ${d}`],
    ['mv x D 2>&1', (d) => `mv x ${d} 2>&1`],
    ['install -m 644 x D 2>/dev/null', (d) => `install -m 644 x ${d} 2>/dev/null`],
    ['cp x D &>/dev/null', (d) => `cp x ${d} &>/dev/null`],
    ['cp x 2> /dev/null D', (d) => `cp x 2> /dev/null ${d}`],
  ];
  for (const [label, build] of forms) {
    test(`${label}: every protected or outside destination is denied`, async () => {
      await withState((state, _wt, run) => {
        for (const dest of DESTINATIONS(state)) expect(run(build(dest))).toMatchObject(BLOCK);
        expect(run(build(settingsOf(state)))).toMatchObject(SETTINGS_BLOCK);
      });
    });
  }

  test('an in-worktree destination stays allowed with a redirect word', async () => {
    await withState((_state, _wt, run) => {
      for (const cmd of ['cp x ./y 2>/dev/null', 'cp x ./y 2>&1', 'cp x 2>/dev/null ./y', 'cp /usr/share/doc/x ./y 2>/dev/null']) {
        expect(run(cmd)).toBeNull();
      }
    });
  });

  test('an allowed state shape stays allowed with a redirect word', async () => {
    await withState((state, _wt, run) => {
      expect(run(`cp x ${state}/staged/1/f.json 2>/dev/null`)).toBeNull();
      expect(run(`echo y | tee ${state}/staged/1/f.json 2>&1`)).toBeNull();
      expect(run(`echo y > ${state}/staged/1/f.json 2>&1`)).toBeNull();
    });
  });
});

describe('a redirect operator written apart from its word, after the destination', () => {
  const commands = ['cp x', 'install x', 'ln -sf x', 'rsync x', 'mv x'];
  const redirects = ['>| ./log', '>| /dev/null', '2>| ./log', '{fd}> ./log', '{fd}>> ./log', '{fd}>/dev/null', '3<> ./log', '<<- EOF\nhi\nEOF'];
  for (const redirect of redirects) {
    test(`D ${redirect.split('\n')[0]}: every protected, outside or settings destination is denied`, async () => {
      await withState((state, _wt, run) => {
        for (const command of commands) {
          for (const dest of DESTINATIONS(state)) expect(run(`${command} ${dest} ${redirect}`)).toMatchObject(BLOCK);
          expect(run(`${command} ${settingsOf(state)} ${redirect}`)).toMatchObject(SETTINGS_BLOCK);
        }
      });
    });
  }

  test('an in-worktree destination stays allowed', async () => {
    await withState((_state, _wt, run) => {
      for (const cmd of ['cp x ./y >| ./log', 'cp x ./y 2>| ./log', 'cp x ./y {fd}>/dev/null', 'cp x ./y {fd}> ./log', 'cp x ./y <<- EOF\nhi\nEOF']) {
        expect(run(cmd)).toBeNull();
      }
    });
  });
});

describe('a redirect operator among env operands before a GIT_TRACE assignment', () => {
  test('the trace file is still judged', async () => {
    await withState((state, _wt, run) => {
      for (const redirect of ['>| ./log', '2>| ./log', '{fd}> ./log', '<<- EOF']) {
        for (const dest of [`${state}/config.json`, `${state}/hook-events/t`, '/etc/x']) {
          expect(run(`env ${redirect} "GIT_TRACE=${dest}" git status\nhi\nEOF`)).toMatchObject(BLOCK);
        }
      }
    });
  });
});

describe('an option after the destination of cp/install/mv', () => {
  const forms: Array<[string, (d: string) => string]> = [
    ['install x D -m 644', (d) => `install x ${d} -m 644`],
    ['install x D --owner root', (d) => `install x ${d} --owner root`],
    ['cp x D -S .bak', (d) => `cp x ${d} -S .bak`],
    ['install x D --mode=644', (d) => `install x ${d} --mode=644`],
    ['install x D -o root -g root', (d) => `install x ${d} -o root -g root`],
    ['cp x D -f', (d) => `cp x ${d} -f`],
    ['mv x D -f', (d) => `mv x ${d} -f`],
    ['cp x D --strange-option value', (d) => `cp x ${d} --strange-option value`],
  ];
  for (const [label, build] of forms) {
    test(`${label}: every protected or outside destination is not allowed`, async () => {
      await withState((state, _wt, run) => {
        for (const dest of DESTINATIONS(state)) expect(run(build(dest))).not.toBeNull();
        expect(run(build(settingsOf(state)))).toMatchObject({ tier: 'block' });
      });
    });
  }

  test('known value options after the destination are denied on the real destination', async () => {
    await withState((state, _wt, run) => {
      for (const cmd of [
        `install x ${state}/config.json -m 644`,
        `install x ${state}/hook-events/e.json --owner root`,
        `cp x ${state}/config.json -S .bak`,
        `install x /etc/x --mode=644`,
        `install x ${state}/config.json -o root -g root`,
        `cp x ${state}/hook-events/e.json -f`,
      ]) {
        expect(run(cmd)).toMatchObject(BLOCK);
      }
    });
  });

  test('an unknown option after the destination judges every positional but the first and warns', async () => {
    await withState((state, _wt, run) => {
      expect(run(`cp x ${state}/config.json --strange-option value`)).toMatchObject(BLOCK);
      expect(run('cp x ./y --strange-option value')).toMatchObject({ tier: 'warn' });
    });
  });

  test('an in-worktree destination stays allowed with a known option after it', async () => {
    await withState((_state, _wt, run) => {
      for (const cmd of ['install x ./y -m 644', 'cp x ./y -f', 'install x ./y --mode=644', 'cp x ./y -S .bak', 'mv x ./y -f']) {
        expect(run(cmd)).toBeNull();
      }
    });
  });

  test('an allowed state shape with a mode option stays allowed', async () => {
    await withState((state, _wt, run) => {
      expect(run(`install x ${state}/staged/1/f.json -m 644`)).toBeNull();
      expect(run(`install -m 644 x ${state}/staged/1/f.json`)).toBeNull();
    });
  });

  test('a GNU long option that takes no value keeps the destination resolved', async () => {
    const flagged: Array<[string, string[]]> = [
      ['cp', ['--remove-destination', '--reflink', '--one-file-system', '--strip-trailing-slashes', '--attributes-only', '--copy-contents', '--keep-directory-symlink', '--debug', '--context']],
      ['ln -s', ['--relative', '--logical', '--physical']],
      ['mv', ['--no-copy', '--exchange', '--context']],
      ['install', ['--preserve-context', '--strip', '--debug']],
    ];
    await withState((state, _wt, run) => {
      for (const [command, flags] of flagged) {
        for (const flag of flags) {
          expect(run(`${command} x ./y ${flag}`)).toBeNull();
          expect(run(`${command} x ${state}/config.json ${flag}`)).toMatchObject(BLOCK);
        }
      }
    });
  });

  test('-t DIR after the sources is still the destination', async () => {
    await withState((state, _wt, run) => {
      expect(run(`cp x -t ${state}/hook-events`)).toMatchObject(BLOCK);
      expect(run(`cp --target-dir=${state}/hook-events x`)).toMatchObject(BLOCK);
    });
  });
});

describe('a destination spelled with adjacent quote segments', () => {
  const quoteSplit = (p: string) => {
    const i = p.lastIndexOf('/') + 1;
    return `'${p.slice(0, i)}'${p.slice(i)}`;
  };
  const doubleSplit = (p: string) => {
    const i = p.lastIndexOf('/') + 1;
    return `"${p.slice(0, i)}"${p.slice(i)}`;
  };
  const sites: Array<[string, (d: string) => string]> = [
    ['redirect', (d) => `echo y > ${d}`],
    ['tee', (d) => `echo y | tee ${d}`],
    ['cp', (d) => `cp x ${d}`],
    ['mv', (d) => `mv x ${d}`],
    ['install', (d) => `install x ${d}`],
    ['truncate', (d) => `truncate -s 0 ${d}`],
    ['rsync', (d) => `rsync x ${d}`],
    ['sed -i', (d) => `sed -i s/a/b/ ${d}`],
    ['sort -o', (d) => `sort -o ${d} x`],
    ['sort --output', (d) => `sort --output=${d} x`],
    ['uniq', (d) => `uniq x ${d}`],
    ['yq -i', (d) => `yq -i . ${d}`],
  ];
  for (const [site, build] of sites) {
    test(`${site}: a quote-split protected or outside target is denied`, async () => {
      await withState((state, _wt, run) => {
        for (const dest of DESTINATIONS(state)) {
          expect(run(build(quoteSplit(dest)))).toMatchObject(BLOCK);
          expect(run(build(doubleSplit(dest)))).toMatchObject(BLOCK);
        }
      });
    });
  }

  test('a quote-split name inside the worktree is never allowed outright', async () => {
    await withState((_state, _wt, run) => {
      expect(run("echo y > './'y")).toMatchObject({ tier: 'warn' });
    });
  });

  test('a quote-split name inside a wrapped double-quoted word keeps its quotes', async () => {
    await withState((state, _wt, run) => {
      expect(run(`cp x "${state}/'config'.json"`)).toMatchObject(BLOCK);
    });
  });

  test('a target whose quote never closes is warned on, never allowed or guessed at', async () => {
    await withState((state, wt, run) => {
      const warn = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };
      expect(run(`echo y > '${wt}/my file'`)).toMatchObject(warn);
      expect(run(`echo y > '${state}/config.json`)).toMatchObject(warn);
      expect(run(`echo y > "${wt}/my file`)).toMatchObject(warn);
      expect(run(`bash -c 'echo hi > ${wt}/x'`)).toMatchObject(warn);
    });
  });

  test('a plainly quoted in-worktree target is unchanged', async () => {
    await withState((_state, _wt, run) => {
      expect(run('echo y > "./y"')).toBeNull();
      expect(run("cp x './y'")).toBeNull();
    });
  });
});
