#!/usr/bin/env bash
# PR lint: mechanical checks that used to be review prose (chef-review
# V-GIT-01, V-STACK-01, V-STACK-02, V-MIGRATE-01). Needs: gh, jq, bun, a full-history checkout, GH_TOKEN, REPO, PR_NUMBER.
# Optional: READY_LABEL (closing issues must carry it), MIGRATION_PATHS (regex),
# NEON_SECRETS_PRESENT ("true"/"false").
set -euo pipefail
fail=0
err() { echo "::error::$*"; fail=1; }
warn() { echo "::warning::$*"; }

pr=$(gh api "repos/$REPO/pulls/$PR_NUMBER")
body=$(jq -r '.body // ""' <<<"$pr")
base=$(jq -r '.base.ref' <<<"$pr")
default_branch=$(gh api "repos/$REPO" -q .default_branch)

# All changed files, paginated (REST, 100 per page, up to GitHub's 3000-file cap).
files=$(gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/files?per_page=100" -q '.[].filename')

# Issues the body closes. GitHub resolves a closing keyword only on a PR targeting the default
# branch, so a stacked PR has none and links with 'Part of #N'.
closing_issues=""
if [ "$base" = "$default_branch" ]; then
  closing_issues=$(grep -oiE '\b(close[sd]?|fix(es|ed)?|resolve[sd]?):? +#[0-9]+' <<<"$body" | grep -oE '[0-9]+$' | sort -un | paste -sd' ' - || true)
fi

# V-GIT-01: an English closing keyword GitHub resolves, or a reference marker to an OPEN issue.
closing=$(wc -w <<<"$closing_issues" | tr -d ' ')
if [ "$closing" -gt 0 ]; then
  if [ -n "${READY_LABEL:-}" ]; then
    not_ready=""
    for n in $closing_issues; do
      labels=$(gh api "repos/$REPO/issues/$n" -q '[.labels[].name] | join("\n")')
      grep -qxF "$READY_LABEL" <<<"$labels" || not_ready="$not_ready #$n"
    done
    [ -z "$not_ready" ] || err "V-GIT-01: closing issue(s)$not_ready lack the '$READY_LABEL' label."
  fi
else
  ref=$(grep -oiE '(part of|related to|follows|follow-up to) +#[0-9]+' <<<"$body" | grep -oE '[0-9]+' | head -n1 || true)
  if [ -z "$ref" ]; then
    err "V-GIT-01: no issue link. Use 'Closes #N' (English; 'Ferme #N' is not resolved by GitHub) or 'Part of #N' / 'Related to #N' for an open issue."
  else
    state=$(gh issue view "$ref" -R "$REPO" --json state -q .state 2>/dev/null || echo MISSING)
    [ "$state" = "OPEN" ] || err "V-GIT-01: 'Part of/Related to #$ref' must point to an OPEN issue (got $state)."
  fi
fi
# Weak references never count as a link (chef-review: WARN for the reviewer).
if grep -qiE '\brefs? +#[0-9]+' <<<"$body"; then warn "V-GIT-01: 'Refs #N' is not an issue link; use Closes/Part of."; fi
if [ "$closing" -eq 0 ] && sed -E 's/(closes|fixes|resolves|part of|related to|follows|follow-up to|refs?) +#[0-9]+//Ig' <<<"$body" | grep -qE '(^|[[:space:](])#[0-9]+'; then
  warn "V-GIT-01: bare or parenthetical '#N' found; it is not an issue link."
fi

# V-STACK-01: base must be the default branch, or the head of a still-open PR (a live stack).
if [ "$base" != "$default_branch" ]; then
  open_parent=$(gh api "repos/$REPO/pulls?state=open&head=${REPO%%/*}:$base&per_page=1" -q 'length')
  [ "$open_parent" -gt 0 ] || err "V-STACK-01: base '$base' is not $default_branch and no open PR has it as head. Retarget to $default_branch."
fi

# V-STACK-02: a PR that overlaps another open PR must be stacked on it (exit 1 refuse, 3 could not check).
if ! bun run scripts/stack-check.ts --pr "$PR_NUMBER" --repo-slug "$REPO" --repo-root "$PWD"; then
  err "V-STACK-02: stack-check refused or could not run for PR #$PR_NUMBER (output above)."
fi

# V-MIGRATE-01: a migration PR needs the deploy secrets present (presence only, never values).
if [ -n "${MIGRATION_PATHS:-}" ] && grep -qE "$MIGRATION_PATHS" <<<"$files"; then
  [ "${NEON_SECRETS_PRESENT:-false}" = "true" ] || err "V-MIGRATE-01: migration changed but NEON_API_KEY / NEON_PROJECT_ID / NEON_PROD_BRANCH_ID are not all set as repo secrets."
fi

[ "$fail" -eq 0 ] && echo "pr-lint: OK"
exit "$fail"
