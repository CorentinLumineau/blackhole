#!/usr/bin/env bash
# PR lint: mechanical checks that used to be review prose (chef-review
# V-GIT-01, V-STACK-01, V-MIGRATE-01). Needs: gh, GH_TOKEN, REPO, PR_NUMBER.
# Optional: MIGRATION_PATHS (regex), NEON_SECRETS_PRESENT ("true"/"false").
set -euo pipefail
fail=0
err() { echo "::error::$*"; fail=1; }

owner=${REPO%%/*}; name=${REPO##*/}
pr=$(gh api graphql -F owner="$owner" -F name="$name" -F n="$PR_NUMBER" -f query='
  query($owner:String!,$name:String!,$n:Int!){ repository(owner:$owner,name:$name){ pullRequest(number:$n){
    body baseRefName closingIssuesReferences(first:1){ totalCount }
    files(first:100){ nodes { path } } } } }' -q .data.repository.pullRequest)
body=$(jq -r '.body // ""' <<<"$pr")
base=$(jq -r '.baseRefName' <<<"$pr")

# V-GIT-01: an English closing keyword GitHub resolves, or a reference marker to an OPEN issue.
closing=$(jq '.closingIssuesReferences.totalCount' <<<"$pr")
if [ "$closing" -eq 0 ]; then
  ref=$(grep -oiE '(part of|related to|follows|follow-up to) +#[0-9]+' <<<"$body" | grep -oE '[0-9]+' | head -n1 || true)
  if [ -z "$ref" ]; then
    err "V-GIT-01: no issue link. Use 'Closes #N' (English; 'Ferme #N' is not resolved by GitHub) or 'Part of #N' / 'Related to #N' for an open issue."
  else
    state=$(gh issue view "$ref" -R "$REPO" --json state -q .state 2>/dev/null || echo MISSING)
    [ "$state" = "OPEN" ] || err "V-GIT-01: 'Part of/Related to #$ref' must point to an OPEN issue (got $state)."
  fi
fi

# V-STACK-01: base must be main, or the head of a still-open PR (a live stack).
if [ "$base" != "main" ]; then
  open_parent=$(gh pr list -R "$REPO" --state open --head "$base" --json number -q 'length')
  [ "$open_parent" -gt 0 ] || err "V-STACK-01: base '$base' is not main and no open PR has it as head. Retarget to main."
fi

# V-MIGRATE-01: a migration PR needs the deploy secrets present (presence only, never values).
if [ -n "${MIGRATION_PATHS:-}" ] && jq -r '.files.nodes[].path' <<<"$pr" | grep -qE "$MIGRATION_PATHS"; then
  [ "${NEON_SECRETS_PRESENT:-false}" = "true" ] || err "V-MIGRATE-01: migration changed but NEON_API_KEY / NEON_PROJECT_ID / NEON_PROD_BRANCH_ID are not all set as repo secrets."
fi

[ "$fail" -eq 0 ] && echo "pr-lint: OK"
exit "$fail"
