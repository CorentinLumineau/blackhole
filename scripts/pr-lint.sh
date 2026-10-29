#!/usr/bin/env bash
# PR lint: mechanical checks that used to be review prose (chef-review
# V-GIT-01, V-STACK-01, V-MIGRATE-01). Needs: gh, jq, GH_TOKEN, REPO, PR_NUMBER.
# Optional: READY_LABEL (closing issues must carry it), MIGRATION_PATHS (regex),
# NEON_SECRETS_PRESENT ("true"/"false").
set -euo pipefail
fail=0
err() { echo "::error::$*"; fail=1; }
warn() { echo "::warning::$*"; }

owner=${REPO%%/*}; name=${REPO##*/}
pr=$(gh api graphql -F owner="$owner" -F name="$name" -F n="$PR_NUMBER" -f query='
  query($owner:String!,$name:String!,$n:Int!){ repository(owner:$owner,name:$name){ pullRequest(number:$n){
    body baseRefName
    closingIssuesReferences(first:20){ nodes { number state labels(first:50){ nodes { name } } } } } } }' \
  -q .data.repository.pullRequest)
body=$(jq -r '.body // ""' <<<"$pr")
base=$(jq -r '.baseRefName' <<<"$pr")

# All changed files, paginated (REST, 100 per page, up to GitHub's 3000-file cap).
files=$(gh api --paginate "repos/$REPO/pulls/$PR_NUMBER/files?per_page=100" -q '.[].filename')

# V-GIT-01: an English closing keyword GitHub resolves, or a reference marker to an OPEN issue.
closing=$(jq '.closingIssuesReferences.nodes | length' <<<"$pr")
if [ "$closing" -gt 0 ]; then
  if [ -n "${READY_LABEL:-}" ]; then
    not_ready=$(jq -r --arg l "$READY_LABEL" '.closingIssuesReferences.nodes[]
      | select([.labels.nodes[].name] | index($l) | not) | "#\(.number)"' <<<"$pr" | paste -sd' ' -)
    [ -z "$not_ready" ] || err "V-GIT-01: closing issue(s) $not_ready lack the '$READY_LABEL' label."
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

# V-STACK-01: base must be main, or the head of a still-open PR (a live stack).
if [ "$base" != "main" ]; then
  open_parent=$(gh pr list -R "$REPO" --state open --head "$base" --json number -q 'length')
  [ "$open_parent" -gt 0 ] || err "V-STACK-01: base '$base' is not main and no open PR has it as head. Retarget to main."
fi

# V-MIGRATE-01: a migration PR needs the deploy secrets present (presence only, never values).
if [ -n "${MIGRATION_PATHS:-}" ] && grep -qE "$MIGRATION_PATHS" <<<"$files"; then
  [ "${NEON_SECRETS_PRESENT:-false}" = "true" ] || err "V-MIGRATE-01: migration changed but NEON_API_KEY / NEON_PROJECT_ID / NEON_PROD_BRANCH_ID are not all set as repo secrets."
fi

[ "$fail" -eq 0 ] && echo "pr-lint: OK"
exit "$fail"
