import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
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
      expect(run(`cp x "${state}/'config'.json"`)).not.toBeNull();
    });
  });

  test('a plainly quoted in-worktree target is unchanged', async () => {
    await withState((_state, _wt, run) => {
      expect(run('echo y > "./y"')).toBeNull();
      expect(run("cp x './y'")).toBeNull();
    });
  });
});

// Head versus origin/main over a generated matrix: head may be stricter than main, never looser.
// Opt in with GUARD_DIFFERENTIAL=1 (needs `origin/main` in the local clone); main is loaded in memory.
const loadMainGuard = () => {
  const cache = new Map<string, unknown>();
  const load = (name: string): unknown => {
    if (cache.has(name)) return cache.get(name);
    const source = execFileSync('git', ['show', `origin/main:templates/hooks/pretooluse/utils/${name}.js`], { encoding: 'utf-8' }).replace(/^#!.*\n/, '');
    const mod = { exports: {} as unknown };
    cache.set(name, mod.exports);
    const req = (id: string) => (id.startsWith('./') ? load(id.slice(2).replace(/\.js$/, '')) : require(id));
    new Function('require', 'module', 'exports', '__dirname', '__filename', source)(req, mod, mod.exports, UTILS, path.join(UTILS, `${name}.js`));
    cache.set(name, mod.exports);
    return mod.exports;
  };
  return load('bash-write-target-guard') as { evaluateBashWriteTargets: (c: string, cwd: string) => Verdict };
};

const RANK = (v: Verdict) => (v === null ? 0 : v.tier === 'warn' ? 1 : 2);

describe.skipIf(!process.env.GUARD_DIFFERENTIAL)('differential against origin/main', () => {
  test('no command main denies or warns on is allowed by head', async () => {
    const main = loadMainGuard();
    await withState((state, wt, run) => {
      const dests = [
        `${state}/config.json`,
        `${state}/hook-events/e.json`,
        `${state}/staged/1/f.json`,
        '/etc/x',
        './y',
        `${wt}/z`,
        'sub/w',
      ];
      const spellings = (d: string) => {
        const i = d.lastIndexOf('/') + 1;
        return [d, `'${d.slice(0, i)}'${d.slice(i)}`, `"${d.slice(0, i)}"${d.slice(i)}`, `"${d}"`, `'${d.slice(0, i)}'"${d.slice(i)}"`];
      };
      const templates: Array<(d: string) => string> = [
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
      ];
      let compared = 0;
      let stricter = 0;
      let corrected = 0;
      const looser: string[] = [];
      for (const dest of dests) {
        for (const spelled of spellings(dest)) {
          for (const build of templates) {
            const command = build(spelled);
            const [before, after] = [main.evaluateBashWriteTargets(command, wt), run(command)];
            compared++;
            if (RANK(after) < RANK(before)) {
              // A mid-command redirect word that main misread is corrected, not loosened, when head
              // judges it exactly as the same command without the redirect word.
              const bare = command.replace(' 2>/dev/null', '');
              if (bare !== command && RANK(run(bare)) === RANK(after)) corrected++;
              else looser.push(`${command}: main ${before?.tier ?? 'allow'} head ${after?.tier ?? 'allow'}`);
            }
            if (RANK(after) > RANK(before)) stricter++;
          }
        }
      }
      console.log(`differential: ${compared} commands, ${stricter} stricter, ${corrected} corrected, ${looser.length} looser`);
      expect(looser).toEqual([]);
    });
  }, 600_000);
});
