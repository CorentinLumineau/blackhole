---
type: plan
summary: "Issue #1347 plan: close the Bash and Write/Edit guard gaps that let a worker reach the main clone's .blackhole/config.json and hook-events/**, split into three PRs with a head-vs-main no-new-allows differential"
status: current
review_trigger: "on file change"
created: 2026-11-19
last_updated: 2026-11-20
related: [decisions/ADR-029-bash-write-target-worktree-containment.md]
---

# Plan - Issue #1347: guard parsing gaps that reach protected state paths

Base: `origin/main` 0aefb8be (`plan_base_commit`). Track: Standard. Implementation starts only after
PR #1334 (same guard file) merges; rebase this plan's line references then.

## Objective

Owner contract: a campaign worker is DENIED writes to the main clone's `.blackhole/config.json` and
`.blackhole/hook-events/**` (and `archive/hook-events-*`). Four review loops on #1346 found
spellings that reach them anyway. Make each gap a deny (or a warn where the target is truly
unresolvable), prefer allow-lists and structural rules to spellings, and ship it as three PRs.

Pareto: Gain 9 x (11 - Effort 6) = 45 (>= 30). No conflict with active rulings R-001..R-006
(`rulings_checked_at: 7`, `ruling_conflicts: []`).

## What main already closes (verified at 0aefb8be, in-memory `evaluateBashWriteTargets`)

Probe: linked worktree + main clone with `.blackhole/{config.json,hook-events,staged}`,
`BLACKHOLE_ASSIGNED_WORKTREE` set. "Closed" = deny or an intended allow.

| Target class | Closed today | Still open (verdict today) |
|---|---|---|
| State dir (`isStateDirTrustedPath`, #1346) | Modelled writers: redirect/`tee`/`cp`/`mv`/`install` to `config.json` or `hook-events/**` are blocked, because `isProtectedStateSegments` and `isPlainLeaf` are never trusted (`cp x STATE/config.json` blocks; `mv STATE/config.json /tmp/x` blocks; `tee STATE/staged/ok.json` allowed as designed). Existing symlink or `..`-free alias is judged by `realpathWithTail`. Python/node/perl one-liners warn. | (a) trailing `2>/dev/null` or `2>&1` after cp/install: ALLOW. (b) `install x D -m 644`, `install x D --owner root`, `cp x D -S .bak`: ALLOW. (c) `cd sl && echo x > ../config.json` (`sl` is a worktree symlink into `STATE/staged`): ALLOW, with or without `-P`. (d) `ln -sfn STATE/hook-events pl && echo x > pl/e.json`: ALLOW. Unmodelled writers `rm`, `touch`, `chmod`, `tar -C/-x`, `unzip -d`, `curl -o`, `wget -O/-P`, `git -C STATE apply/checkout`, `git --work-tree`, `patch -d`, `xargs`: ALLOW. Hard link `ln STATE/config.json h && echo x > h`: ALLOW. |
| Settings files (`isSettingsFilePath`, #1349) | Same modelled writers block; `isSettingsFilePath` runs on every resolved target before containment. | Same (a)-(d) and unmodelled-writer paths: the settings file is only checked for targets the guard extracts. `rm`/`tar`/`curl -o` on `.claude/settings*.json` of the main clone: ALLOW. |
| Outside-worktree paths | Every modelled writer's destination outside the assigned root blocks. | (a)/(b) apply to any outside path (`cp x /etc/x 2>/dev/null` ALLOW). `rm -rf /tmp/zzz`, `touch`, `chmod`, `tar`, `curl -o`, ... ALLOW. Dangling-symlink Write/Edit leaf (`validate-file-changes.js`, `resolveExistingAncestor` resolves a dangling leaf to its parent): open. |

Conclusion: #1346 and #1349 added an allow-list for what MAY land in the state dir, but it is only
consulted for targets the parser extracts. Every open item is either a parser that mis-extracts the
destination (a, b), a resolver that disagrees with the kernel (c, d, dangling leaf, hard link), or a
writer that produces no target at all (rm, tar, curl, ...). The allow-list needs no change.

## Split (three PRs, in order; each independently shippable)

| PR | Scope | Items | Size |
|---|---|---|---|
| 1 | Operand parsing | (a) redirect words inside operands, (b) option after destination | s |
| 2 | Kernel-faithful resolution | (c) `cd`/`..` through a symlink, (d) same-command link then write, worktree-side hard link, Write/Edit dangling-symlink leaf | m |
| 3 | Unmodelled writers | protected-target deny for every non-reader command; warn-tier for known mutators outside the worktree; link planting via interpreters stays warn | m |

**Owner decision (campaign decisions 21/23): only PR 1 is built.** PRs 2 and 3 are not built; their
gaps (kernel-faithful resolution, unmodelled writers) are documented residual risk, covered by the
sandbox direction tracked in #1357. Issue #1347 stays open as the residual-risk record. PR 1 also
routes the adjacent-quote word sites (redirect, tee, cp/mv/install, truncate, rsync, sed -i,
sort -o, uniq, yq -i) through the literal-word decoder.

PR 1 is highest value per effort (a one-line-class parser fix per site) and unblocks the owner
contract for the two most direct bypasses. PR 3 depends on PR 2's resolver. Splitting beyond three
would only create stacked PRs on one 1715-line file (V-STACK-02).

## Shared requirements (every PR)

1. **Head-vs-main differential (no new allows).** Add `scripts/hooks-guard-differential.test.ts`
   and `scripts/fixtures/hooks-write-guard-baseline-verdicts.json`: a corpus of commands (every
   must-DENY/must-ALLOW row below plus the existing test suites' command rows) run through the real
   hook in `withLinkedWorktree` fixtures. The JSON records origin/main's verdict per row
   (`allow` < `warn` < `block`). The test fails when head's verdict is LESS severe than the baseline
   for any row. A row may only gain severity unless listed in an explicit `intentional_relaxations`
   array that needs a reason and a `same_as` command the shell runs identically; the relaxed row is
   then held to that command's baseline. PR 1 lists 63, each a row main misread (a mid-command
   redirect word, or a `{fd}>` named-fd redirect) whose `same_as` is the same command without that
   one redirect, which the test checks. The baseline is recorded once from the
   `plan_base_commit` and extended (never re-recorded) by PRs 2 and 3. Snapshot over `git show
   origin/main:` because CI checkouts may not carry main's object.
2. **Red before green**: each AC's test is written first and run against unmodified main to show it
   fails (V-UNFALSIFIABLE-01); the PR body quotes that run for one row per item.
3. **Data-structure citation**: before any AC asserts on `LOCAL_*`-style lookup structures, read the
   production call site. This plan's ACs assert on hook exit codes and `pattern_id`, not on
   internals.
4. Build: the guard source is `templates/hooks/pretooluse/**`; touch-paths plus all generated dist
   trees per `scripts/lib/build/targets.ts`. `V-PLUGIN-01` requires a `package.json` version bump in
   the same diff, then `bun run build`.
5. Local verification is scoped (one focused spec per `ci-first-verification`); CI runs the suites.

## Touch-Paths

- `templates/hooks/pretooluse/utils/bash-write-target-guard.js` (PR 1, 2, 3)
- `templates/hooks/pretooluse/utils/hook-event-log.js` (PR 2: `physicalResolve`, hard-link identity; PR 3: protected-path predicate for non-reader commands)
- `templates/hooks/pretooluse/utils/state-dir-write-shape.js` (PR 1: operands now exclude redirect words; verify only)
- `templates/hooks/pretooluse/validate-file-changes.js` (PR 2: dangling leaf, hard-link identity)
- `templates/hooks/pretooluse/README.md` (PR 3: reader allow-list and mutator table)
- `scripts/hooks-bash-write-operands.test.ts` (new, PR 1), `scripts/hooks-bash-write-resolution.test.ts` (new, PR 2), `scripts/hooks-bash-write-unmodelled.test.ts` (new, PR 3)
- `scripts/hooks-validate-file.test.ts` (PR 2, new rows only)
- `scripts/hooks-guard-differential.test.ts`, `scripts/fixtures/hooks-write-guard-baseline-verdicts.json` (new, PR 1; extended later)
- `package.json` (version bump), plus all generated dist trees per `scripts/lib/build/targets.ts`
- `documentation/decisions/ADR-029-bash-write-target-worktree-containment.md` (amendment note, PR 3 only if the reader allow-list is adopted)

## Critical Files

- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`
- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/state-dir-write-shape.js`

## Codebase Conventions

- Verdict tiers: `block` -> `bash-outside-assigned-worktree` / `bash-settings-roots-write`; `warn` ->
  `bash-write-target-unresolvable` (`evaluateBashWriteTargets`, line ~1626). New denies reuse these
  `pattern_id`s unless a new one is needed to tell the cases apart in the event log.
- Test style: `runPreToolUseHook` + `withLinkedWorktree` + `readHookEvents`
  (`scripts/hooks-bash-write-options.test.ts`), one `test()` per form, new files per PR so parallel
  hook PRs do not conflict (the stated reason for the existing split files).
- Redirect word grammar already exists: `REDIRECT_WORD_RE` and `REDIRECT_ONLY_WORD_RE` (guard
  ~line 999); reuse, do not add a third (V-INT-02).
- `rsyncTargets` (guard ~676) is the precedent for "option after positional => destination
  uncertain: judge every positional but the first, and warn".
- Comment discipline: one canonical rationale per concept, no issue numbers in comments.

## Task Breakdown

### PR 1: operand parsing

- **T1.1** `positionalArgsBeforeRedirect` skips redirect words instead of stopping at a token that
  merely starts with `<>&`: a word matching `REDIRECT_WORD_RE` (`2>/dev/null`, `2>&1`, `&>f`,
  `>>f`) is dropped, an operator-only word (`REDIRECT_ONLY_WORD_RE`: `2>`, `<<<`, `>`) also drops
  the next token, and scanning continues so a destination after a mid-command redirect
  (`cp x 2>/dev/null DEST`) is still seen. The redirect target itself stays judged by
  `findRedirectTargets`. — **AC**: every must-DENY row (a1-a6) exits 2 with
  `bash-outside-assigned-worktree`; every must-ALLOW row (a7-a9) exits 0 with no event.
- **T1.2** Option after the destination. In `findCopyMoveWrites` for `cp`/`mv`/`install`, parse
  options with a value-taking set per command (`install -m -o -g -t -S -T`, `cp -S -t -T`, `mv -S -t
  -T`, attached and `=` forms). When an option follows the first positional and any option is outside
  that set, treat the destination as uncertain: judge every positional except the first and emit
  `UNRESOLVABLE_TARGET` (the `rsyncTargets` rule). Known value options are skipped so the real last
  positional is judged. — **AC**: b1-b6 block; b7-b9 allow; a trusted state-dir shape
  (`install x STATE/staged/f -m 644`) stays allowed and `parseSingleFileCopy` still sees exactly one
  source and one destination.
- **T1.3** Differential harness and baseline (shared requirement 1). — **AC**:
  `hooks-guard-differential.test.ts` passes on head, and fails when a deliberately weakened guard
  (one row flipped to allow in a scratch copy) is run, shown in the PR body.
- **T1.4** Version bump, build, dist trees. — **AC**: `bun run build` leaves a clean tree;
  `V-PLUGIN-01` satisfied.

Must-DENY (PR 1), each also run with the destination in `hook-events/`, in `config.json` and in a
settings file:
- a1 `cp x STATE/config.json 2>/dev/null`; a2 `install x STATE/config.json 2>&1`;
  a3 `cp x 2>/dev/null STATE/config.json`; a4 `cp x /etc/x 2>/dev/null`; a5 `mv x STATE/config.json 2>&1`;
  a6 `install -m 644 x STATE/hook-events/e.json 2>/dev/null`.
- b1 `install x STATE/config.json -m 644`; b2 `install x STATE/config.json --owner root`;
  b3 `cp x STATE/config.json -S .bak`; b4 `cp x STATE/hook-events/e.json -f`; b5
  `install x STATE/config.json --mode=644`; b6 `install x STATE/config.json -o root -g root`.

Must-ALLOW (PR 1): a7 `cp x ./y 2>/dev/null` and `cp x ./y 2>&1` (inside worktree); a8 `tee STATE/staged/ok.json < x`
(state allow-list unchanged); a9 `cp /usr/share/doc/x ./y 2>/dev/null` (outside source, inside dest);
b7 `install x ./y -m 644`; b8 `cp x ./y -f`; b9 `install x STATE/staged/f.json -m 644` (state-dir
shape with a file destination).

### PR 2: kernel-faithful resolution

- **T2.1** `physicalResolve(base, target, overlay)` in `hook-event-log.js`: start at
  `realpath(base)`; per segment `..` -> dirname, `.` -> skip, else join; when the joined path is a
  symlink (existing or dangling, `lstat` + `readlink`, depth cap 40) replace it by its target and
  continue; a missing tail is appended. This is how the kernel opens a relative path, so `sl/../x`
  collapses after `sl` resolves, unlike `path.resolve`. The guard's final loop judges
  `physicalResolve` of every literal target and keeps the existing lexical verdict too: deny when
  EITHER is outside (never fewer denies than today). — **AC**: c1-c4 block, c5-c6 allow.
- **T2.2** `cd` produces both candidates. `cdDestinations` adds the physical destination alongside
  the logical one to `dirs` (the union machinery and `MAX_CWD_CANDIDATES` already exist), which
  covers `cd -P`, `set -P`, `cd -o physical` without enumerating spellings. — **AC**: c3 `cd -P sl
  && cd .. && echo x > config.json` blocks.
- **T2.3** Same-command link overlay. While walking clauses, an `ln -s TARGET LINK` (any
  `-s`/`--symbolic`/`-f`/`-n`/`-T`/`-t` mix, parsed by the T1.2 option set) records
  `overlay[abs(LINK)] = abs(TARGET)`; `physicalResolve` consults the overlay before the filesystem.
  An `ln` whose options cannot be parsed marks the command unresolvable (warn, as today). — **AC**:
  d1-d4 block, d5 allows.
- **T2.4** Hard links. (i) A hard-link-capable writer (`ln` without `-s`, `cp -l`/`--link`) has its
  SOURCE judged as a write target (the new name aliases the inode). (ii) Existing-leaf identity:
  a target leaf with `nlink > 1` is compared by `(dev, ino)` against `STATE/config.json` and the
  entries of `STATE/hook-events` (capped at 256 entries, fail closed to warn beyond the cap); a match
  is a block. `pnpm` store links (`nlink > 1`, no match) stay allowed. Applies to Bash targets and to
  `validate-file-changes.js`. — **AC**: h1-h4 block, h5-h6 allow.
- **T2.5** Write/Edit dangling leaf (`validate-file-changes.js`, ~line 163): the containment,
  state-dir and extra-root checks resolve the leaf with `physicalResolve` (readlink on a dangling
  link) instead of `resolveExistingAncestor`'s parent fallback. — **AC**: w1-w3 deny, w4-w5 allow.
- **T2.6** Extend the baseline JSON with PR 2 rows. — **AC**: differential green.

Must-DENY (PR 2):
- c1 `cd sl && echo x > ../config.json`; c2 `cd -P sl && echo x > ../config.json`; c3 `cd -P sl &&
  cd .. && echo x > config.json`; c4 `cp x sl/../hook-events/e.json`.
- d1 `ln -sfn STATE/hook-events pl && echo x > pl/e.json`; d2 `ln -s STATE/hook-events/new.json lk
  && echo x > lk`; d3 `ln -s STATE pl && cp x pl/config.json`; d4 same in a `cd`-ed subdirectory
  with a relative link target.
- h1 `ln STATE/config.json h && echo x > h`; h2 `cp -l STATE/config.json h && echo x > h`;
  h3 pre-existing worktree hard link to `config.json`, then `echo x > h` (separate command);
  h4 Write/Edit to that same worktree hard link.
- w1 Write to a worktree symlink dangling toward `STATE/hook-events/new.json`; w2 same via a
  relative dangling target (`../../main/.blackhole/hook-events/n.json`); w3 chain of two dangling
  links; (and Edit for each).

Must-ALLOW (PR 2): c5 `cd sub && echo x > ../ok.txt` (plain directory, inside worktree); c6 `cd -P
sub && echo x > ../ok.txt`; d5 `ln -s ./a ./b && echo x > b` (link target inside worktree); h5
`pnpm`-style file with `nlink > 1` and no match; h6 `ln a b` (source inside worktree); w4 Write to a
dangling symlink whose target is inside the worktree; w5 Write through an existing symlink into
`STATE/staged` with a plain leaf (state-dir allow-list unchanged).

### PR 3: unmodelled writers

- **T3.1** Protected-target rule (structural, allow-list based). For every clause, after PR 2's
  resolver, if the clause's command is NOT on a small reader allow-list (`cat`, `head`, `tail`,
  `ls`, `stat`, `wc`, `grep`/`rg` without `--pre`, `diff`, `jq` without `-i`/`--in-place`, `file`,
  `readlink`, `realpath`, `test`, `[`, `echo`, `printf`, `cd`, `pwd`, `git` read subcommands
  `log|show|diff|status|rev-parse|ls-files` without `--output`) then every word, and the value part
  of an option word (`--opt=V`, `-CV`, `-d V`), that resolves (via `physicalResolve`, base = each
  `dirs` candidate) onto a protected state path or settings file is a block. Protected means
  `isProtectedStateSegments` paths, the state root, `archive/`, and `isSettingsFilePath`.
  A clause whose base directory is itself protected and whose command is non-reader (`cd STATE/
  hook-events && rm -rf *`, `find . -delete`) is also a block. No list of writers is needed: the
  reader list is the allow-list and a new writer is denied by default. — **AC**: u1-u14 block;
  u15-u20 allow.
- **T3.2** Outside-worktree tier for known mutators. `rm rmdir unlink touch chmod chown chattr
  shred tar unzip curl wget patch, and git (apply|checkout|restore|clean|reset) with
  -C/--work-tree/--git-dir` with a literal operand outside the assigned root and every trusted
  extra root: tier `warn` (`bash-write-target-unresolvable`-style) by default, `block` only if the
  owner answers open question 1. Dynamic operands (`xargs`, `$VAR`, globs) stay warn. — **AC**:
  o1-o6 warn; o7-o9 allow.
- **T3.3** Interpreter link planting stays in the warn tier (python/node/perl/ruby `-c/-e`
  already warn); T3.1 additionally blocks such a one-liner whose code text contains a literal
  protected path (substring on the realpath of the state root plus `config.json`/`hook-events`),
  which is the only same-command plant that can be detected without executing it. Residual risk
  stated, not hidden: a one-liner assembling the path dynamically stays warn. — **AC**: i1-i3 block,
  i4 warns, i5 allows.
- **T3.4** `README.md` table: reader allow-list, mutator list, tier per row. Extend baseline.
  — **AC**: differential green; README lists every reader and mutator in the code (a tiny
  assertion in the unmodelled test compares the exported arrays to the README table rows).

Must-DENY (PR 3): u1 `rm -rf STATE/hook-events`; u2 `touch STATE/config.json`; u3 `chmod 000
STATE/config.json`; u4 `tar -xf e.tar -C STATE`; u5 `unzip e.zip -d STATE`; u6 `curl -o
STATE/config.json http://x`; u7 `wget -O STATE/config.json u`; u8 `wget -P STATE u`; u9 `git -C
STATE apply p.diff`; u10 `git --work-tree=STATE checkout .`; u11 `patch -d STATE < p.diff`; u12
`echo STATE/config.json | xargs rm`; u13 `cd STATE/hook-events && rm -rf *`; u14 `rm -rf
<main>/.claude/settings.local.json`. Interpreter: i1 `python3 -c "import os;os.symlink('STATE/
hook-events','pl')"`; i2 node -e; i3 perl -e with the literal path.
Must-ALLOW (PR 3): u15 `cat STATE/config.json`; u16 `ls STATE/hook-events`; u17 `jq . STATE/
config.json`; u18 `git log --oneline`; u19 `rm -rf ./build` and `touch ./x`; u20 `tar -xf e.tar -C
./out` (inside worktree). Warn: o1 `rm -rf /tmp/zzz`; o2 `touch /var/x`; o3 `tar -xf e.tar -C /opt`;
o4 `curl -o /opt/f u`; o5 `xargs rm < list`; o6 `patch -d /opt < p`. Allow: o7 `rm -rf <scratchpad>/x`
(trusted extra root); o8 `rm -rf ./x`; o9 `curl -o ./x u`; i4 `python3 -c "print(1)"` -> allow
(already); i5 `python3 -c "open('./x','w')"` warns (already).

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS (no schema or public API change; hook verdict `pattern_id`s reused) |
| `ac_mapping` | PASS (each task carries an AC) |
| `critical_files_exist` | PASS (all four paths exist at 0aefb8be) |
| `mitigation_concrete` | PASS (each strategy bullet below has an if/abort condition) |
| ADVISORY `ac_sweep_scope` | none: no sweep-to-zero AC |

## Execution Strategy & Stop Conditions

- If PR #1334 has not merged, do not start: both edit the same file. If it merges with changes to
  `positionalArgsBeforeRedirect`, `findCopyMoveWrites` or `collectWriteSignals`, rebase and re-read
  before editing; abort and re-plan the affected task if its anchor no longer exists.
- If any differential row becomes less severe on head than the baseline, stop and revert that
  change; a loosened row is never fixed by editing the baseline.
- If the T1.2 option rule blocks a row in the existing suites (`hooks-bash-write-*.test.ts`) that was
  allowed on main and is not a protected or outside target, abort the rule and narrow it to
  protected-and-outside targets only.
- If `physicalResolve` costs more than 20 ms on a 40-segment path in a fixture (the hook has a
  deadline; #1222 precedent), stop and fall back to a single `realpath` per candidate.
- If the PR 3 reader allow-list blocks a command the existing suites or the campaign playbooks run
  (grep `src/references/phase-*.md` for the commands first), add that command to the reader list
  with a test, never relax the deny rule.
- If `bun run build` leaves dist-tree drift outside `templates/hooks/**` outputs, stop and
  investigate before committing.

## Dependency Blast-Radius

| Consumer | Class | Note | verification |
|---|---|---|---|
| `findTeeTargets` (guard ~459) | TRANSPARENT | uses `positionalArgsBeforeRedirect`; `<<<` here-string must still be excluded | reasoned: covered by must-ALLOW a8 and the existing tee tests |
| `findCopyMoveWrites` (guard ~696) | BREAKING (intended) | new verdicts for a-rows and b-rows | executed: baseline run of `scripts/hooks-bash-write-*.test.ts` on the plan base before editing (via with-test-lock) |
| `parseSingleFileCopy` / `isSingleFileCopy` (`state-dir-write-shape.js`) | TRANSPARENT | receives operands without redirect words; trust shape unchanged | reasoned: b9 |
| `resolveExistingAncestor` users in `validate-file-changes.js` | DEPRECATION | leaf check migrates to `physicalResolve`; helper stays for other callers | executed: `hooks-validate-file.test.ts` focused run |
| generated copies (`plugins/*/hooks`, `.claude/hooks`, `.agents/build/hooks`) | TRANSPARENT | rebuilt, not hand-edited | executed: `bun run build` clean tree |
| `findTeeTargets`, `findSedTargets` (sed files), `findOptionWriteTargets` (`sort -o`, `uniq`, `yq -i`; guard ~1098) | TRANSPARENT | now read operands through `positionalArgsSkippingRedirects`, so a spaced redirect operator and its word are dropped before the command's own options are parsed | executed: `bun test scripts/hooks-guard-differential.test.ts` (tee, sed, sort, uniq, yq templates) |
| `truncate`, `rsync`, `dd`, `ln` through `findCopyMoveWrites` (guard ~804) | BREAKING (intended) | same reader; `ln`/`rsync` take the last operand as destination, so a missed redirect operator would demote the real destination | executed: differential `ln -sf x D >| ./log`, `rsync x D >| ./log` rows, and `hooks-bash-write-operands.test.ts` |
| `targetWord` at every write-target site (`findRedirectTargets`, tee, sed files, truncate, rsync, sort, uniq, yq) | TRANSPARENT | decodes quote-split spellings; the quote-split matrix covers each site | executed: `bun test scripts/hooks-bash-write-operands.test.ts` |
| `findGitTraceTargets` (guard ~1188) | TRANSPARENT | shares `REDIRECT_WORD_RE`/`REDIRECT_ONLY_WORD_RE`; a `{fd}>`/`>|`/`<<-` word now skips its target word instead of reading it as a slot word | executed: `bun test scripts/hooks-bash-write-options.test.ts` (GIT_TRACE rows) |

## Scope Amendments

- **Widen (PR 1)**: `documentation/plans/plan-guard-parsing-gaps.md` ships in PR 1 as the durable
  plan, and `documentation/INDEX.md` is regenerated for its row (a pure function of the tree).
- **Widen (PR 1)**: `scripts/fixtures/` is a new directory holding only the differential baseline.
- **Deviation (T1.3)**: the corpus is the generated matrix (8 destinations x 7 spellings x 63
  templates, which includes the a- and b-rows above); the existing suites' command rows were not
  imported, since those suites already run in CI with their own assertions.
- **Deviation (T1.3)**: the differential calls `evaluateBashWriteTargets` in memory, the function
  the hook runs, rather than spawning the hook per row: about 3,500 rows at one process each would
  exceed CI's 60 s per-test timeout. The opt-in `GUARD_DIFFERENTIAL` block in
  `hooks-bash-write-operands.test.ts` is removed; this file is the one differential.

## Threat Model (STRIDE)

| Threat | Severity | Mitigation | Status |
|---|---|---|---|
| Spoofing: a worker forges a path spelling (`2>&1` glue, option order, link) so the guard judges a different file than the shell writes | High | PR 1 judges the real destination; PR 2 resolves as the kernel does; differential forbids new allows | Mitigated (after PR 1+2) |
| Tampering: overwrite `config.json`, plant or edit events in `hook-events/**` | Critical | PR 1-3 deny at the protected set; the state-dir allow-list is untouched | Mitigated (PR 3 closes unmodelled writers); dynamic interpreter path assembly remains warn |
| Repudiation: erase the audit trail (`rm -rf hook-events`) | Critical | T3.1 denies any non-reader naming it; events record the deny | Mitigated (after PR 3) |
| Information disclosure: reading `config.json` | Low | readers stay allowed by design (R-contract covers writes) | Accepted Risk |
| Denial of service: hook deadline blown by symlink loops or large `hook-events` scans | Medium | depth cap 40, `nlink > 1` only, 256-entry cap failing to warn, timing stop condition | Mitigated |
| Elevation of privilege: a worker alters settings roots to widen `trustedWriteRoots` | High | T3.1 includes `isSettingsFilePath` for all non-reader commands | Mitigated (after PR 3) |

## Decision Record

- **Context**: ~25 spellings reach the same two protected targets; main's four review loops each
  found a new spelling in a hand-enumerated parser.
- **Alternatives**: (easy) add a clause per reported spelling and a deny for each missing writer
  (rm, tar, curl, ...); (hard, chosen) fix the three root causes: extract the true destination
  (skip redirect words, uncertain destination on trailing options), resolve as the kernel does
  (`physicalResolve`, dual `cd` candidates, link overlay, inode identity), and invert the
  unmodelled-writer problem into a reader allow-list for protected targets. A further hard option,
  a fully shell-faithful parser or an OS sandbox (bubblewrap/Landlock mount of `.blackhole` read-only),
  removes the whole class but is a separate infrastructure project and not portable to the supported
  harnesses.
- **Choice**: the three-root-cause approach in three PRs, with the sandbox noted as a follow-up
  issue (filed per the opportunistic-hygiene rule).
- **Rationale**: the easy path guarantees a fifth review loop; the chosen one costs one resolver
  helper and a small allow-list, and the differential test makes "no new allows" mechanical.
- **Confidence**: Medium-High.

## Open Questions (owner)

1. PR 3 mutators outside the worktree but not protected (`rm /tmp/x`): warn (default) or block?
   Block widens the contract beyond config.json/hook-events and may hit legitimate scratch cleanup.
2. Reader allow-list for protected paths: confirm that workers must keep read access to
   `config.json` and `hook-events/` (assumed yes).
3. Sandbox (read-only bind of `.blackhole` for workers) as a separate follow-up issue: file it?
4. `status-artifact.json` and other state files are outside this plan's protected set; confirm the
   protected set stays `config.json`, `hook-events/**`, `archive/hook-events-*` plus settings files.
