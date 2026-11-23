import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, withLinkedWorktree } from './lib/test-fixtures.ts';

// Issue #1344: prose inside a quoted message argument (`gh issue comment --body "..."`,
// `git commit -m "..."`) was scanned for redirects, so an arrow `a -> /path` or a spelled-out
// `2>/dev/null.` became a write target, and a quoted `<<'EOF'` heredoc marker kept even grep's
// quoted pattern from being treated as text. A real, unquoted redirect must still be seen.

const guard = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'bash-write-target-guard.js'));

const verdict = (template: string, mainRepo: string, worktree: string) =>
  guard().evaluateBashWriteTargets(template.replaceAll('<main>', mainRepo), worktree);

const QUOTED_TEXT_ONLY = [
  `gh issue comment 1 --body "cat <<'EOF' then a -> <main>/.blackhole was denied"`,
  `gh issue comment 1 --body "a -> <main>/x was denied"`,
  `gh issue comment 1 --body "silence it with 2>/dev/null. Then retry"`,
  `gh issue comment 1 --body "silence it with 2>/dev/null."`,
  `gh issue create --title "a -> b" --body 'cat <<EOF -> <main>/x'`,
  `gh pr comment 7 --body "heredoc <<'EOF' maps x -> <main>/y"`,
  `gh pr create --title t --body "x -> <main>/y"`,
  `git commit -m "map a -> <main>/x"`,
  `git commit -m "cat <<'EOF' a -> <main>/x" -m "second -> <main>/z"`,
  `git tag -a v1 -m "a -> <main>/x"`,
  `grep "cat <<'EOF' a -> <main>/x" f`,
  `gh issue comment 1 --body "look at sh -c and source: a -> <main>/x"`,
];

const REAL_WRITES = [
  `gh issue comment 1 --body "a -> b" > <main>/x`,
  `gh issue comment 1 --body "cat <<'EOF' -> b" >> <main>/x`,
  `gh issue comment 1 --body "cat <<EOF"\necho hi > <main>/x`,
  `cat <<'EOF' > <main>/x\na -> b\nEOF`,
  `cat <<'EOF'\na -> b\nEOF\necho hi > <main>/x`,
  `gh issue comment 1 --body "$(echo hi > <main>/x)"`,
  'gh issue comment 1 --body "`echo hi > <main>/x`"',
  `gh issue comment 1 --body "a" && bash -c "echo hi > <main>/x; true"`,
  `jq -n "a -> b" > <main>/x`,
  `curl -d "cat <<'EOF' -> b" https://example.invalid >> <main>/x`,
  `bash -c "echo hi -> <main>/x; true"`,
  `git commit -m "a -> b" 2> <main>/x`,
];

describe('bash-write-target-guard.js — redirect-shaped text inside a quoted message (#1344)', () => {
  for (const command of QUOTED_TEXT_ONLY) {
    test(`#1344: no write target in ${JSON.stringify(command)}`, async () => {
      await withLinkedWorktree('blackhole-hook-1344-', async (mainRepo, worktree) => {
        expect(verdict(command, mainRepo, worktree)).toBeNull();
      });
    });
  }

  for (const command of REAL_WRITES) {
    test(`#1344: a real write outside the worktree is still denied in ${JSON.stringify(command)}`, async () => {
      await withLinkedWorktree('blackhole-hook-1344-', async (mainRepo, worktree) => {
        expect(verdict(command, mainRepo, worktree)).toMatchObject({
          tier: 'block',
          pattern_id: 'bash-outside-assigned-worktree',
        });
      });
    });
  }
});
