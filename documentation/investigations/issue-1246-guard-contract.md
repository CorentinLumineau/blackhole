---
type: analysis
summary: "Write-guard contract for GIT_TRACE* writes (issue #1246): what blocks, what warns, and the named residuals review may not block on"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-26
related: [investigations/issue-1246-git-trace.md, ../src/references/hook-schemas.md]
---

# Issue #1246: the `GIT_TRACE*` write-guard contract

This is the normative boundary for how `bash-write-target-guard.js` handles `GIT_TRACE*`
variables. The bug narrative and history are in `issue-1246-git-trace.md`. PR #1257's review
rounds 6 to 9 kept finding holes in parsing that the fix rounds themselves had added, because no
boundary was written down. This document is that boundary: anything it does not list as
blocked or warned is a named residual.

## The contract

Terms used below:

- **Command position**: an index `commandPositions()` returns when it is run from the clause's
  command-word index, i.e. the index `skipCompoundWords` returns, which `collectWriteSignals`
  already computes as `k`. So the body of `case x in a)`, `f() {`, `function f {`, `if … then`
  and `while … do` counts. Today `commandPositions` anchors at token 0, so `env "GIT_TRACE=/x"`
  inside a `case` arm or a function body is not read at the PR head.
- **Slot word**: a word the shell or a program reads as `NAME=VALUE`. That is (a) a shell
  prefix assignment, (b) a word at a command position (a wrapper operand, such as
  `sudo "GIT_TRACE=/x" git`), (c) an `env` operand before `env`'s command, and (d) an operand of
  `export`, `declare`, `typeset`, `local` or `readonly` when that declarer is at a command
  position.
- **Not an operand**: a redirect operator and its target word (`> "$out"`, `2>&1`). Also not an
  operand: a word that continues an unclosed `(`, `$(` or backtick opened by an earlier word of
  the same slot run. `tokenize` splits `export X=$(cmd "$y")` into `X=$(cmd` and `"$y")`, so the
  second word is part of the first word's value. Count parens outside quotes, using
  `skipQuotedSpan`, and ignore backslash-escaped parens.
- **Exact word**: a word with none of `$`, backtick, `\`, `{` or `}` in its raw text. Its text
  after `normalizeShellWord` is exactly what bash produces, because single and double quotes
  then carry only literal text. A word holding a backslash is opaque, so a quoted trace word
  with a backslash stays on Tier 2.
- **Opaque word**: any other word. Its text after expansion cannot be read from the command
  string.
- **Trace name**: `/^GIT_TRACE\w*$/`, matched case-sensitively, as git reads it.
- **Trace mention (M)**: the whole command with `'`, `"` and `\` removed matches
  `/GIT_|TRACE/`. Only the allexport rule uses M.

### Tier 1: RESOLVE (block if the target is outside the worktree)

Tier 1 covers a trace-name assignment whose name and value are both read exactly. That is
either:

- an unquoted, plain `NAME=VALUE` or `NAME+=VALUE` (raw text matches
  `^[A-Za-z_]\w*\+?=`) anywhere in a clause. This includes a prefix assignment, any slot, and any
  operand. The operand case (`make GIT_TRACE=/x`) is today's deliberate over-match, F-00562; or
- an **exact** slot word whose normalized text is `NAME=VALUE`. This covers `env "GIT_TRACE=/x"`,
  `env 'GIT_TRACE'=/x`, `export "GIT_TRACE=/x"` and `sudo "GIT_TRACE=/x"`.

The value is judged as exact text. A raw value holding `$`, backtick, `\`, `{` or `}` is Tier 2:

| Value (exact text) | Result |
|---|---|
| holds `*`, `?`, `[` or `]`, or starts with `~` | Tier 2 WARN |
| absolute path | write target; `literalTargets` containment blocks it outside the assigned root |
| anything else (`1`, `true`, `0`, `false`, `2`-`9`, empty, relative, `af_unix:…`) | no file, silent |

**Relative values write nothing.** The round-10 brief proposed resolving relative values too. Git opens only absolute paths. This was verified on git 2.56.0 in
this session: `GIT_TRACE=rel-trace-file git --version` prints `warning: unknown trace value for
'GIT_TRACE': rel-trace-file … set GIT_TRACE to an absolute pathname` and creates no file. The
issue body agrees. Resolving relative values would block `GIT_TRACE=1`-style values after a
`cd`, with no write behind them.

**Quote-only names are Tier 1.** The round-10 brief proposed putting "quote-assembled" names in
Tier 2. Here, a slot word with only `'`/`"` quoting is resolved exactly. Quote removal
of such a word is the `normalizeShellWord` behaviour main already uses for every other write
target, and no round-6 to round-9 BLOCK came from it. This keeps the issue's headline repro,
`env "GIT_TRACE=<main>/x" git status`, a BLOCK. Every other assembly is Tier 2, since it
involves `$'…'`, `$"…"`, a backslash, a brace or an expansion.

### Tier 2: WARN (`bash-write-target-unresolvable`), keyed on slot and raw shape, never on token mention

Any of these makes the command unresolvable:

1. **`env -S` / `--split-string` in any spelling.** That includes a cluster ending in `S`
   (`-iS…`, `-vS`), glued or separate, quoted or not, and any long option that is not one of the
   exact long names (abbreviations included). The splitter is deleted, and no `-S` string is
   ever read.
2. **Any `env` option word that is not an exact GNU env 9.4 spelling** once its quotes are
   removed. The exact spellings are a cluster of `i0v` optionally ending in `u`, `C` or `a` with
   a glued or next-word value, `-`, `--`, and the full long names. An option word that is
   opaque (`-\u`, `$'\x2du'`, `$OPT`) also warns.
3. **An opaque word in a slot that holds `=` in its raw text and whose raw prefix before the
   first `=` is not a plain identifier.** Examples: `{X,GIT}_TRACE=`, `${P}TRACE=`,
   `"$P$Q=…"`, `$'GIT_TRAC\x45=…'`, `$"GIT_TRACE=…"`, `"GIT_TRACE=…$'…'"`. This applies to any
   name, not only trace names, because the name is unknown.
4. **An opaque `env` operand before `env`'s command, or an opaque declarer operand, even
   without `=`.** It may expand to an assignment or an option, as in `env $X git`,
   `env $'GIT_TRACE\x3d/x' git`, `export "$N"`, `export {X,GIT_TRACE}` or
   `export $(cat .env)`. Words that are not operands (see Terms) are excluded. That covers array
   elements after `NAME=(`, the continuation of `X=$(cmd "$y")`, and redirect targets.
5. **A trace-name assignment whose value is not exact or is a glob or `~`** (see the Tier-1
   value table). Examples: `GIT_TRACE=$LOG`, `GIT_TRACE=\/x`, `env GIT_TRACE=<wt>/*`.
6. **A bare declarer operand naming a trace name**, exact after quote removal:
   `export GIT_TRACE`, `export 'GIT_TRACE'`, `declare -x GIT_TRACE_PACKET`,
   `export A GIT_TRACE`. This holds whatever the rest of the command runs.
7. **A nameref declarer**: `declare`, `typeset` or `local` with an option cluster holding `n`
   (`-n`, `-gn`). `export -n` (un-export) is not a nameref.
8. **allexport + M.** A `set` at a command position whose normalized operands hold a
   single-dash cluster containing `a`, the word `allexport`, or any opaque operand. Also a
   `shopt` at a command position with `-o` in a cluster and the operand `allexport`. Either
   warns when the command has a trace mention (M). Without M, it is silent:
   `set -a; source .env; npm test` stays allowed.

### Tier 3: named residuals (disclosed, never BLOCK in review)

| Id | Residual | Tracking |
|---|---|---|
| R1 | `eval` strings | disclosed |
| R2 | Shell functions defined in an earlier command | disclosed |
| R3 | State set by an earlier command or the inherited environment: an earlier `set -a`, `export GIT_TRACE=…`, `sudo --preserve-env`, `source .env` with no visible trace token | disclosed |
| R4 | Names assembled at runtime with no visible token **outside a slot**, e.g. `set -a; read "$(printf '\x47IT_TRAC\x45')"` (token-less allexport) or `${P,,}` case conversion | disclosed |
| R5 | Unknown wrappers in front of `env` or a declarer: `setsid`, `taskset`, `chrt`, `flock`, `systemd-run --setenv` | #1283 (append `taskset`, `chrt`, `flock`, `systemd-run`) |
| R6 | Shell `-c` strings and `bash -a`: `bash -c 'GIT_TRACE=/x git status'` | #1318 |
| R7 | `envChdirBase` reading quoted or abbreviated `-C` for relative targets | #1282 (F-00592) |
| R8 | `$"…"` command names | #1290 |
| R10 | A quoted or assembled `NAME=VALUE` read by a non-`env` program (`make "GIT_TRACE=/x"`, `xargs -I{} env "GIT_TRACE={}"`) | append to #1283 |
| R11 | git config trace targets (`git -c trace2.eventTarget=…`, config includes) | F-00563 (deferred) |
| R12 | `GIT_EXEC_ENV_RE`'s `runsGit` gate misses git inside `$(…)` (`GIT_EXTERNAL_DIFF=/x; export GIT_EXTERNAL_DIFF; echo "$(git diff)"`). Pre-existing on main and not a trace variable | file an issue (none found) |
| R13 | Command-substitution bodies (`x=$(GIT_TRACE=/x git status)`, backticks, `<(…)`) are not clauses for any write target, `cp`/`tee` included. Pre-existing on main | #1252 |
| R14 | An opaque word after `sudo`/`doas` (`sudo $X git status`), which those programs may read as `NAME=VALUE` | append to #1283 |

### Round-10 review acceptance rule (what may BLOCK)

A round-10 security finding on #1246 may be **BLOCK** only when an *executed* command does one
of these:

- **Tier-1 miss**: it matches the Tier-1 definition, git writes outside the worktree, and the
  guard does not block.
- **Tier-2 miss**: it contains a construct listed in Tier 2 items 1-8, and the guard returns
  null.
- **Regression**: it makes a row in the § Closure table's "allow (correct)" column, or one of the
  everyday commands in § WARN volume, produce a hook event.

Everything else is not a BLOCK. If an attack uses only a named residual R1-R8 or R10-R14, cite the
residual id as a NOTE. If it shows a new mechanism outside every slot, the reviewer proposes
a new residual row with an issue to file (WARN), and it does not block #1246. A reviewer may
not add a parsing obligation that is outside this contract. A reviewer who believes the
contract itself is wrong files that as one WARN against this file, not as a BLOCK against the
code.

## Closure table (iterations 6-9, every executed attack and allow row, plus one-step mutations)

`<m>` is the main clone and `<wt>` is the worktree. "Head" is the verdict at b9f29835.

The Head column is the verdict at b9f29835, from a run of `evaluateBashWriteTargets`. Rows from
iterations 6-9 were run by the reviewers, as their comments state. Mutation rows (`mut`) and
rows 71-84 were run by the round-10 planner against a scratch repo with a linked worktree.

| # | Source | Command | Head | Contract | Rule |
|---|---|---|---|---|---|
| 1 | it6 | `export "GIT_TRACE=<m>/evil$'\x2f..\x2f<wt>\x2fz'"; git status` | block | WARN | T2-3 (opaque slot word) |
| 2 | it6 | `export "GIT_TRACE=<wt>/a$'\x00/<rel>/y'"` | block | WARN | T2-3 |
| 3 | it6 | `env --unset B "GIT_TRACE=<m>/x" git status` | block | BLOCK | T1 exact slot word |
| 4 | it6 | `env --chdir /tmp "GIT_TRACE=<m>/x" git status` | block | BLOCK | T1 |
| 5 | it6 | `env '-u' B "GIT_TRACE=<m>/x" git status` | block | BLOCK | T1 (option normalized exact) |
| 6 | it7 | `env --uns B "GIT_TRACE=<m>/x" git status` | warn | WARN | T2-2 |
| 7 | it7 | `env --u B …` | warn | WARN | T2-2 |
| 8 | it7 | `env --ch /tmp …` | warn | WARN | T2-2 |
| 9 | it7 | `env --split "A=1 GIT_TRACE=<m>/x" git status` | warn | WARN | T2-1 |
| 10 | it7 | `env -S 'A=1\_GIT_TRACE=<m>/x git status'` | warn | WARN | T2-1 |
| 11 | it7 | `env -S"A=1\_GIT_TRACE=<m>/x git status"` | warn | WARN | T2-1 |
| 12 | it7 | `printf -v GIT_TRACE %s <m>/x; export GIT_TRACE; git status` | warn | WARN | T2-6 |
| 13 | it7 | `read GIT_TRACE <<< <m>/x; export GIT_TRACE; git status` | warn | WARN | T2-6 |
| 14 | it7 | `env '-C' <m> tee x` (F-00592) | allow | residual | R7 #1282 |
| 15 | it7 | `export "GIT_TRACE=<m>/.worktrees/\wt"` (F-00593 trace instance) | allow | WARN | T2-3 (backslash makes it opaque) |
| 16 | it7 | `echo x > "<m>/.worktrees/\wt"` (F-00593 generic) | deny | BLOCK | `normalizeShellWord` keeps the backslash inside double quotes (#1308) |
| 17 | it7 | `$"cp" a <m>/b`, `$"tee" <m>/x` | allow | residual | R8 #1290 |
| 18 | it8 | `BS='\'; env -S "A=1${BS}_GIT_TRACE=<m>/x git status"` | warn | WARN | T2-1 |
| 19 | it8 | `X=' '; env -S "A=1${X}GIT_TRACE=…"` | warn | WARN | T2-1 |
| 20 | it8 | `env -S "A=1$(printf ' ')GIT_TRACE=…"` | warn | WARN | T2-1 |
| 21 | it8 | `env -S 'GIT_TRAC${NOPE}E=<m>/x git status'` | warn | WARN | T2-1 |
| 22 | it8 | `env -S "GIT_TRACE='<wt>/a /../../out/x'" git status` | warn | WARN | T2-1 |
| 23 | it8 | `printf -v …; export GIT_TRACE; (git status)` | warn | WARN | T2-6 |
| 24 | it8 | `…; export GIT_TRACE; bash -c 'git status'` | warn | WARN | T2-6 |
| 25 | it8 | `…; export GIT_TRACE; echo "$(git status)"` | warn | WARN | T2-6 |
| 26 | it8 | `…; export GIT_TRACE{,}; git status` | warn | WARN | T2-4 |
| 27 | it8 | `set -a; printf -v GIT_TRACE %s <m>/x; git status` | warn | WARN | T2-8 |
| 28 | it8 | `GIT_EXTERNAL_DIFF=/x; export GIT_EXTERNAL_DIFF; echo "$(git diff)"` | allow | residual | R12 (pre-existing, not trace) |
| 29 | it9 | `env -S "GIT_TRACE=<wt>/a<U+00A0>/../../main/x git status"` | **allow** | WARN | T2-1 |
| 30 | it9 | same with U+3000 | **allow** | WARN | T2-1 |
| 31 | it9 | `export {X,GIT}_TRACE=<m>/x; git status` | **allow** | WARN | T2-3 |
| 32 | it9 | `env {X,GIT}_TRACE=<m>/x git status` | **allow** | WARN | T2-3 |
| 33 | it9 | `printf -v GIT_TRACE …; export {X,GIT_TRACE}; git status` | **allow** | WARN | T2-4 |
| 34 | it9 | `…; export {GIT,X}_TRACE; …` | **allow** | WARN | T2-4 |
| 35 | it9 | `P=GIT_; env ${P}TRACE=<m>/x git status` | **allow** | WARN | T2-3 |
| 36 | it9 | `export ${P}TRACE=<m>/x; git status` | **allow** | WARN | T2-3 |
| 37 | it9 | `env "$P$Q=<m>/x" git status` | **allow** | WARN | T2-3 (whatever command set P/Q) |
| 38 | it9 | `declare -x "$P$Q=<m>/x"` | **allow** | WARN | T2-3 |
| 39 | it9 | `N=GIT_TRACE; printf -v "$N" %s <m>/x; export "$N"; git status` | **allow** | WARN | T2-4 |
| 40 | it9 | `declare -n R=GIT_TRACE; export R=<m>/x; git status` | **allow** | WARN | T2-7 |
| 41 | it9 | `set -o errexit -o allexport; printf -v GIT_TRACE %s <m>/x; git status` | **allow** | WARN | T2-8 |
| 42 | it9 | `set -o pipefail -a; …` | **allow** | WARN | T2-8 |
| 43 | it9 | `set -euo pipefail -a; …` | **allow** | WARN | T2-8 |
| 44 | it9 | `set '-a'; …` | **allow** | WARN | T2-8 |
| 45 | it9 | `set \-a; …` | **allow** | WARN | T2-8 |
| 46 | it9 | `set -a; printf -v GIT_TRAC\E %s <m>/x; git status` | **allow** | WARN | T2-8 (M strips `\`) |
| 47 | it9 | `set -a; printf -v 'GIT_'TRACE …` | **allow** | WARN | T2-8 |
| 48 | it9 | `set -a; read -r GIT_TRAC\E <<< <m>/x; git status` | **allow** | WARN | T2-8 |
| 49 | it9 | `setsid env -S '…'` | allow | residual | R5 #1283 |
| 50 | it9 | `taskset -c 0 env -S '…'` | allow | residual | R5 #1283 |
| 51 | it9 | `chrt …`, `flock …` before `env` | allow | residual | R5 #1283 |
| 52 | it9 | `bash -c 'cp a <m>/x'`, `sh -c "cp a <m>/x"` | allow | residual | R6 #1318 |
| 53 | mut | `export $'\x47IT_TRAC\x45=<m>/x'` | block | WARN | T2-3 |
| 54 | mut | `export {G,X}IT_T{R,}ACE=<m>/x` | allow | WARN | T2-3 |
| 55 | mut | `env $'GIT_TRACE\x3d<m>/x' git status` (no visible `=`) | block | WARN | T2-4 |
| 56 | mut | `shopt -os allexport; printf -v GIT_TRACE %s <m>/x; git status` | allow | WARN | T2-8 |
| 57 | mut | `set -$'a'; printf -v GIT_TRACE …; git status` | allow | WARN | T2-8 (opaque `set` operand) |
| 58 | mut | `typeset -n R=GIT_TRACE …` / `local -n …` | allow | WARN | T2-7 |
| 59 | mut | `env -vS'GIT_TRACE=<m>/x git status'` | block | WARN | T2-1 |
| 60 | mut | `env --split-s="GIT_TRACE=<m>/x git status"` | warn | WARN | T2-1/2 |
| 61 | mut | `X='GIT_TRACE=<m>/x'; env $X git status` | allow | WARN | T2-4 |
| 62 | mut | `export $(echo GIT_TRACE=<m>/x); git status` | block | BLOCK | T1 (unquoted plain word `GIT_TRACE=<m>/x)`) |
| 63 | mut | `set -a; source <(echo GIT_TRACE=<m>/x); git status` | block | BLOCK | T1 (unquoted plain word) |
| 64 | mut | `exec env -S 'GIT_TRACE=<m>/x git status'` (`exec` is a `COMMAND_PREFIXES` entry) | block | WARN | T2-1 |
| 65 | mut | `GIT_TRACE=\<m>/t git status` | block | WARN | T2-5 |
| 66 | mut | `make GIT_TRACE=<m>/x` (unquoted operand) | block | BLOCK | T1 (F-00562 over-match) |
| 67 | mut | `make "GIT_TRACE=<m>/x"` | allow | residual | R10 |
| 68 | mut | `set -a` in an earlier Bash call, then `printf -v GIT_TRACE …; git status` | n/a (two calls) | residual | R3 |
| 69 | mut | `git -c trace2.eventTarget=<m>/x status` | allow | residual | R11 F-00563 |
| 70 | mut | `eval 'GIT_TRACE=<m>/x git status'` | allow | residual | R1 |
| 71 | it1-2 | `env 'GIT_TRACE'=<m>/x git status`, `export "GIT_TRACE=<m>/x"` | block | BLOCK | T1 exact slot |
| 72 | it1-2 | `GIT_TRACE+=<m>/x git status` | block | BLOCK | T1 |
| 73 | mut | `case x in a) export "GIT_TRACE=<m>/x";; esac; git status` | block | BLOCK | T1 (command position past compound words) |
| 74 | mut | `f() { export "GIT_TRACE=<m>/x"; }; f; git status` | block | BLOCK | T1 |
| 75 | mut | `function f { export "GIT_TRACE=<m>/x"; }; f; git status` | block | BLOCK | T1 |
| 76 | mut | `if true; then export "GIT_TRACE=<m>/x"; fi; git status` | block | BLOCK | T1 |
| 77 | mut | `while true; do export "GIT_TRACE=<m>/x"; done` | block | BLOCK | T1 |
| 78 | mut | `case x in a) env "GIT_TRACE=<m>/x" git status;; esac` | **allow** | BLOCK | T1 (command position past compound words) |
| 79 | mut | `f() { env "GIT_TRACE=<m>/x" git status; }; f` | **allow** | BLOCK | T1 |
| 80 | mut | `case x in a) export {X,GIT}_TRACE=<m>/x;; esac` | **allow** | WARN | T2-3 |
| 81 | mut | `export $(printf 'GIT_TRACE=%s' <m>/x); git status` | **allow** | WARN | T2-4 |
| 82 | mut | `P=GIT_; Q=TRACE; env "$P$Q=<m>/x" git status` | **allow** | WARN | T2-3 |
| 83 | mut | `export X=$(true) "GIT_TRACE=<m>/x"; git status` | block | BLOCK | T1 (the paren closes inside `X=$(true)`) |
| 84 | mut | `export X=\( "GIT_TRACE=<m>/x"; git status` | block | BLOCK | T1 (an escaped paren opens nothing) |
| 85 | mut | `x=$(GIT_TRACE=<m>/x git status)`, `echo "$(…)"`, backtick form | allow | residual | R13 #1252 |
| 86 | mut | `sudo $X git status` | allow | residual | R14 |

Allow rows (iterations 8 and 9), which must stay allowed with no hook event unless marked as a
flip:

| # | Command | Head | Contract |
|---|---|---|---|
| A1 | `git status` | allow | allow |
| A2 | `env FOO=1 git status` / `env FOO=1 git log` | allow | allow |
| A3 | `env -i PATH=/usr/bin git log` | allow | allow |
| A4 | `env --ignore-environment --null git status` | allow | allow |
| A5 | `set -a; source .env; npm test` | allow | allow (no M) |
| A6 | `set -a; . ./.env; set +a; npm test` | allow | allow |
| A7 | `set -euo pipefail; git status` | allow | allow (cluster has no `a`) |
| A8 | `export GIT_TRACE=1; git status` | allow | allow (no file) |
| A9 | `export PATH="$HOME/bin:$PATH"; git status` | allow | allow (plain name, not trace) |
| A10 | `declare -x FOO=bar; git status` | allow | allow |
| A11 | `git commit -m 'GIT_TRACE=/x'` | allow | allow (not a slot) |
| A12 | `export GIT_TRACE; echo done` | warn | WARN (T2-6, accepted in round 9) |
| A13 | `env -S 'FOO=1 git status'` | allow | **WARN flip** (T2-1) |
| A14 | `env -S "FOO=1 BAR=2 git log"` | allow | **WARN flip** |
| A15 | `env --split-string='A=1 git status'` | allow | **WARN flip** |
| A16 | `export X=$(cmd "$y"); git status` | allow | allow (continuation word) |
| A17 | `local d=$(dirname "$0")` | allow | allow |
| A18 | `export X="$(git rev-parse --show-toplevel)"` | allow | allow |
| A19 | `declare -a arr=("$a" "$b"); git status` | allow | allow (array elements) |
| A20 | `grep -rn export "$DIR"` | allow | allow (declarer counts only at a command position) |

**Closure counts** (attack rows 1-86):

- **BLOCK: 17** (rows 3, 4, 5, 62, 63, 66, 71-79, 83, 84)
- **WARN: 55**
- **Named residual: 14** (rows 14, 16, 17, 28, 49-52, 67-70, 85, 86)
- **Silent allow: 0**

Every row the head allows among rows 29-48 and 78-82 now blocks or warns.

Allow rows: 16 stay allowed, 1 was already WARN, and 3 flip from allow to WARN. Those 3 are all
`env -S`, which is a deliberate refusal.

No row moves from block or warn to allow.

## WARN volume

**Corpus**: 704 distinct real Bash commands from `.blackhole/hook-events/` and
`.blackhole/archive/hook-events-*` (2026-08-10 to 2026-11-18). These are biased: they hold only
commands that already produced an event. A wider transcript scan was refused by the permission
classifier and was not retried. Approximate Tier-2 matchers found:

- `env -S`: 2 commands, both reviewer probe scripts for this PR, where the `env -S` text is
  inside a quoted `node -e` body, so it is not a guard slot.
- Unscoped opaque declarer operands: 0.
- `set -a`/allexport: 0.
- Bare trace export: 0.
- Opaque env operands: 0.

12 commands mention `GIT_`/`TRACE`. Mention alone triggers nothing.

**Everyday commands** (evaluated on paper against the contract; all silent unless marked):

| Command | Verdict |
|---|---|
| `git status`, `git diff --stat`, `git log --oneline -5`, `git add -A`, `git commit -m "…"`, `git push -u origin b`, `git fetch --prune`, `git worktree prune` | silent |
| `gh pr view 1257 --json comments`, `gh issue view 1246 --json title,body` | silent |
| `bun test scripts/x.test.ts`, `bun run verify`, `npm test`, `npm ci`, `NODE_OPTIONS=--max-old-space-size=1536 with-test-lock bun test x` | silent |
| `ls -la`, `cat f`, `head -50 f`, `sed -n 1,80p f`, `jq '.x' f`, `rg pattern src`, `grep -rn export "$DIR"`, `find . -name '*.ts'` | silent (declarer counts only at a command position) |
| `mkdir -p d && cd d && make`, `make GIT_TRACE=1` | silent |
| `export PATH="$HOME/bin:$PATH"`, `export NODE_ENV=test`, `FOO=1 cmd`, `env FOO=1 cmd`, `timeout 60 env A=1 cmd` | silent |
| `set -euo pipefail; …`, `set -a; source .env; set +a` | silent |
| `declare -A map`, `declare -a arr=("$a" "$b")`, `local x="$1"` | silent (array elements skipped) |
| `export $(grep -v '^#' .env \| xargs)`, `env $(cat .env) node app.js` | **WARN** (T2-4). Rare; 0 of 704 in the corpus |
| `export "$k=$v"` (in a loop) | **WARN** (T2-3). Rare; 0 of 704 |

Estimate: on everyday agent commands, Tier 2 fires on fewer than 1 in 700. The only realistic
hits are dotenv-into-`export`/`env` idioms, which are genuinely unresolvable. Triage load is
negligible.


## Residuals closed by #1342

Silent allows left by the closure table: a `GIT_TRACE*` slot word (a quoted or exact word the
shell or `env` reads as `NAME=VALUE`, or a declarer operand) is judged only when the scan knows
which word is the command. Each row below resolved to no verdict before and now resolves by the
contract tier shown (`M` is a path outside the assigned root).

| Command | Before | Now |
|---|---|---|
| `2> ./log env "GIT_TRACE=M/x" git status` (leading redirect) | silent | BLOCK (T1) |
| `< /dev/null export "GIT_TRACE=M/x"; git status` | silent | BLOCK (T1) |
| `< /dev/null export GIT_TRACE; git status` | silent | WARN (T2) |
| `$(true) 2> ./log env "GIT_TRACE=M/x" git status` (substitution that may expand to nothing, then a redirect) | silent | BLOCK (T1) |
| `case x in a)env "GIT_TRACE=M/x" git status;; esac` (label glued to the command) | silent | BLOCK (T1) |
| `case ${x:-a b} in a)env "GIT_TRACE=M/x" git status;; esac` (case word split on a space) | silent | BLOCK (T1) |
| `set -a; cat <<EOF` with `GIT_TRACE` only in the heredoc body or a comment | silent | WARN (T2-8) |
| `${X:+a b} env "GIT_TRACE=M/x" git status` (braced expansion holding a space, which may expand to nothing) | silent | BLOCK (T1) |

The allexport mention test (T2-8) now reads the whole command rather than the heredoc-masked
view of one text. A value inside the assigned root, a relative value and a non-file value such as
`GIT_TRACE=1` stay allowed in every row.
