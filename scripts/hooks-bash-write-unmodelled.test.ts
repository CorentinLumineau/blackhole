import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, withLinkedWorktree, writeCampaignConfig } from './lib/test-fixtures.ts';

// Writers the Bash write guard did not model used to return ALLOW for any target, so a worker
// could erase or forge the hook event log or replace config.json in the main clone's state dir
// with `rm`, `touch`, `tar -C`, `curl -o`, `git -C … checkout`, an `xargs`-fed writer or a link.
// Each one must reach the containment check on the path it writes.

const UTILS = path.join(PRETOOLUSE_HOOKS_DIR, 'utils');
const guardOf = (dir: string) => require(path.join(dir, 'bash-write-target-guard.js'));

type Verdict = { tier: string; pattern_id: string } | null;

const withState = async (fn: (state: string, wt: string, run: (command: string) => Verdict) => void | Promise<void>) =>
  withLinkedWorktree('blackhole-unmodelled-', async (main, wt) => {
    writeCampaignConfig(main, { forge: 'github' });
    const state = path.join(fs.realpathSync(main), '.blackhole');
    for (const sub of ['staged/1', 'hook-events']) fs.mkdirSync(path.join(state, sub), { recursive: true });
    fs.writeFileSync(path.join(state, 'hook-events', 'old.json'), '{}');
    fs.writeFileSync(path.join(wt, 'x'), 'x');
    await fn(state, wt, (command) => guardOf(UTILS).evaluateBashWriteTargets(command, wt));
  });

const BLOCK = { tier: 'block', pattern_id: 'bash-outside-assigned-worktree' };
const WARN = { tier: 'warn', pattern_id: 'bash-write-target-unresolvable' };

/** File targets: the state dir's protected files, and a path outside every root. */
const FILES = (state: string) => [`${state}/config.json`, `${state}/hook-events/e.json`, `${state}/hook-events/old.json`, '/etc/x'];
/** Directory targets a writer extracts or downloads into. */
const DIRS = (state: string) => [state, `${state}/hook-events`, '/etc'];

describe('file writers the guard did not model', () => {
  const forms: Array<[string, (f: string) => string]> = [
    ['rm', (f) => `rm ${f}`],
    ['rm -rf', (f) => `rm -rf ${f}`],
    ['rm -f --', (f) => `rm -f -- ${f}`],
    ['rmdir', (f) => `rmdir ${f}`],
    ['unlink', (f) => `unlink ${f}`],
    ['shred -u', (f) => `shred -u -n 1 ${f}`],
    ['touch', (f) => `touch ${f}`],
    ['touch -d DATE', (f) => `touch -d "2 days ago" ${f}`],
    ['chmod', (f) => `chmod 600 ${f}`],
    ['chmod -R', (f) => `chmod -R u+w ${f}`],
    ['chown', (f) => `chown root:root ${f}`],
    ['chgrp', (f) => `chgrp wheel ${f}`],
    ['mkdir -p', (f) => `mkdir -p ${f}`],
    ['mkdir -m', (f) => `mkdir -m 700 ${f}`],
    ['rename', (f) => `rename s/x/y/ ${f}`],
    ['curl -o', (f) => `curl -sSL -o ${f} https://example.invalid/x`],
    ['curl -sSLo', (f) => `curl -sSLo ${f} https://example.invalid/x`],
    ['curl --output', (f) => `curl --output ${f} https://example.invalid/x`],
    ['curl --output=', (f) => `curl --output=${f} https://example.invalid/x`],
    ['curl -D', (f) => `curl -D ${f} https://example.invalid/x`],
    ['curl --cookie-jar', (f) => `curl --cookie-jar ${f} https://example.invalid/x`],
    ['wget -O', (f) => `wget -q -O ${f} https://example.invalid/x`],
    ['wget --output-document=', (f) => `wget --output-document=${f} https://example.invalid/x`],
    ['wget -o log', (f) => `wget -o ${f} https://example.invalid/x`],
    ['patch FILE', (f) => `patch ${f} < x`],
    ['patch -o', (f) => `patch -o ${f} x < y`],
    ['tar -cf', (f) => `tar -cf ${f} x`],
    ['tar czf (old style)', (f) => `tar czf ${f} x`],
    ['tar --create --file=', (f) => `tar --create --file=${f} x`],
    ['hard link ln SRC h', (f) => `ln ${f} h`],
    ['find -delete', (f) => `find ${f} -delete`],
    ['find -fprint', (f) => `find . -fprint ${f}`],
  ];
  for (const [label, build] of forms) {
    test(`${label}: a protected or outside target is denied`, async () => {
      await withState((state, _wt, run) => {
        for (const file of FILES(state)) expect(run(build(file))).toMatchObject(BLOCK);
      });
    });
  }

  test('the same writers on an in-worktree target stay allowed', async () => {
    await withState((_state, _wt, run) => {
      for (const cmd of [
        'rm ./x',
        'rm -rf ./build',
        'rmdir ./d',
        'unlink ./x',
        'touch ./x',
        'touch -d "2 days ago" ./x',
        'chmod 600 ./x',
        'chmod -R u+w ./d',
        'mkdir -p ./a/b',
        'mkdir -m 700 ./a',
        'curl -sSLo ./x https://example.invalid/x',
        'curl -o ./x https://example.invalid/x',
        'wget -q -O ./x https://example.invalid/x',
        'patch -p1 < x.diff',
        'patch ./x < x.diff',
        'tar -cf ./a.tar x',
        'ln x ./h',
        'find ./build -delete',
        'find . -name x -print',
      ]) {
        expect(run(cmd)).toBeNull();
      }
    });
  });
});

describe('directory writers the guard did not model', () => {
  const forms: Array<[string, (d: string) => string]> = [
    ['tar -xf A -C D', (d) => `tar -xf x -C ${d}`],
    ['tar -C D -xf A', (d) => `tar -C ${d} -xf x`],
    ['tar xf A -C D (old style)', (d) => `tar xf x -C ${d}`],
    ['tar -xzf A --directory=D', (d) => `tar -xzf x --directory=${d}`],
    ['tar --extract --file A --directory D', (d) => `tar --extract --file x --directory ${d}`],
    ['unzip A -d D', (d) => `unzip -o x -d ${d}`],
    ['unzip -dD', (d) => `unzip x -d${d}`],
    ['curl --output-dir D -O', (d) => `curl --output-dir ${d} -O https://example.invalid/x`],
    ['wget -P D', (d) => `wget -P ${d} https://example.invalid/x`],
    ['wget --directory-prefix=D', (d) => `wget --directory-prefix=${d} https://example.invalid/x`],
    ['patch -d D', (d) => `patch -d ${d} -p1 < x.diff`],
    ['patch --directory=D', (d) => `patch --directory=${d} -p1 < x.diff`],
    ['git -C D apply', (d) => `git -C ${d} apply x.diff`],
    ['git -C D checkout', (d) => `git -C ${d} checkout HEAD -- .`],
    ['git -C D restore', (d) => `git -C ${d} restore config.json`],
    ['git --work-tree=D checkout', (d) => `git --work-tree=${d} checkout HEAD -- .`],
    ['git --work-tree D reset --hard', (d) => `git --work-tree ${d} reset --hard`],
  ];
  for (const [label, build] of forms) {
    test(`${label}: a protected or outside directory is denied`, async () => {
      await withState((state, _wt, run) => {
        for (const dir of DIRS(state)) expect(run(build(dir))).toMatchObject(BLOCK);
      });
    });
  }

  test('the same writers into the worktree stay allowed', async () => {
    await withState((_state, wt, run) => {
      for (const cmd of [
        'tar -xf x',
        'tar -xf x -C ./out',
        `tar xzf x -C ${wt}/out`,
        'tar -tf x',
        'unzip -o x',
        'unzip x -d ./out',
        'unzip -l x',
        'curl -O https://example.invalid/x',
        'curl -s https://example.invalid/x',
        'wget -q https://example.invalid/x',
        'wget -P ./dl https://example.invalid/x',
        'patch -d ./sub -p1 < x.diff',
        'git apply x.diff',
        'git -C . checkout HEAD -- .',
        `git -C ${wt} restore x`,
        'git status',
      ]) {
        expect(run(cmd)).toBeNull();
      }
    });
  });

  test('a read-only git subcommand on an outside base stays allowed', async () => {
    await withState((state, _wt, run) => {
      const main = path.dirname(state);
      for (const cmd of [`git -C ${main} status`, `git -C ${main} log -1`, `git -C ${main} fetch origin main`, `git -C ${main} rev-parse HEAD`]) {
        expect(run(cmd)).toBeNull();
      }
    });
  });
});

describe('writers whose target the command string does not show', () => {
  test('an xargs-fed writer is never a silent allow', async () => {
    await withState((state, _wt, run) => {
      for (const cmd of [
        `echo ${state}/config.json | xargs rm`,
        `echo ${state}/hook-events | xargs rm -rf`,
        `printf '%s\\n' ${state}/hook-events/old.json | xargs -I{} cp x {}`,
        `echo ${state} | xargs -n1 touch`,
        'ls | xargs -0 chmod 600',
        `find ${state} -name '*.json' -print0 | xargs -0 rm -f`,
      ]) {
        expect(run(cmd)).not.toBeNull();
      }
    });
  });

  test('find -exec running a writer is never a silent allow', async () => {
    await withState((state, _wt, run) => {
      expect(run(`find ${state}/hook-events -name '*.json' -exec rm {} \;`)).toMatchObject(BLOCK);
      expect(run(`find . -exec rm {} +`)).toMatchObject(WARN);
    });
  });

  test('a read-only xargs or find stays allowed', async () => {
    await withState((_state, _wt, run) => {
      for (const cmd of ['ls | xargs echo', 'git ls-files | xargs grep -n foo', 'find . -name x -exec grep -l y {} +', 'ls | xargs wc -l']) {
        expect(run(cmd)).toBeNull();
      }
    });
  });

  test('a tar extract that keeps absolute or .. member names is unresolvable', async () => {
    await withState((_state, _wt, run) => {
      expect(run('tar -xPf x')).toMatchObject(WARN);
      expect(run('tar -xf x --absolute-names')).toMatchObject(WARN);
    });
  });

  test('a curl or wget reading its options from a file is unresolvable', async () => {
    await withState((_state, _wt, run) => {
      expect(run('curl -K cfg https://example.invalid/x')).toMatchObject(WARN);
      expect(run('wget -e output_document=y https://example.invalid/x')).toMatchObject(WARN);
    });
  });
});

describe('links planted toward a protected state path', () => {
  test('ln -s whose link target is in the state dir is denied, within one command too', async () => {
    await withState((state, _wt, run) => {
      expect(run(`ln -s ${state}/hook-events pl`)).toMatchObject(BLOCK);
      expect(run(`ln -sfn ${state}/hook-events pl && echo x > pl/e.json`)).toMatchObject(BLOCK);
      expect(run(`ln -s ${state}/config.json ./c`)).toMatchObject(BLOCK);
      expect(run(`ln -s ${state}/hook-events/new.json ./n`)).toMatchObject(BLOCK);
      expect(run(`ln -s -t . ${state}/config.json`)).toMatchObject(BLOCK);
    });
  });

  test('ln -s to an ordinary path outside the worktree warns, inside it stays allowed', async () => {
    await withState((state, _wt, run) => {
      expect(run(`ln -s ${path.dirname(state)}/node_modules ./node_modules`)).toMatchObject(WARN);
      expect(run('ln -s ./x ./alias')).toBeNull();
      expect(run('ln -sf x ./alias')).toBeNull();
    });
  });

  test('a redirect through a dangling symlink is judged where the link lands', async () => {
    await withState((state, wt, run) => {
      fs.symlinkSync(`${state}/hook-events/new.json`, path.join(wt, 'dangling'));
      fs.symlinkSync('/etc/blackhole-dangling-x', path.join(wt, 'dangling-etc'));
      fs.symlinkSync('./not-yet', path.join(wt, 'dangling-inside'));
      expect(run('echo x > dangling')).toMatchObject(BLOCK);
      expect(run(`echo x > ${wt}/dangling-etc`)).toMatchObject(BLOCK);
      expect(run('echo x > dangling-inside')).toBeNull();
    });
  });
});

describe('path operations in a trusted extra root', () => {
  test('rm, touch and mkdir stay allowed in the scratchpad, never in the state dir', async () => {
    await withState((state, wt, run) => {
      const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'blackhole-unmodelled-scratch-'));
      try {
        const inScratch = (command: string) => guardOf(UTILS).evaluateBashWriteTargets(command, wt, { scratchpad_dir: scratch });
        for (const cmd of [`rm -rf ${scratch}/build`, `touch ${scratch}/f`, `mkdir -p ${scratch}/a/b`, `curl -o ${scratch}/log https://example.invalid/x`]) {
          expect(inScratch(cmd)).toBeNull();
        }
        expect(inScratch(`rm -rf ${scratch}/../x`)).toMatchObject(BLOCK);
        expect(inScratch(`tar -xf x -C ${scratch}`)).toMatchObject(BLOCK);
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
      expect(run(`rm ${state}/staged/1/f.json`)).toMatchObject(BLOCK);
      expect(run(`touch ${state}/staged/1/f.json`)).toMatchObject(BLOCK);
      expect(run(`mkdir -p ${state}/staged/2`)).toMatchObject(BLOCK);
    });
  });
});
