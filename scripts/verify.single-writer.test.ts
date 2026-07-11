import { describe, expect, test } from 'bun:test';
import {
  findMissingGateMarkers,
  ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS,
  ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS,
} from './verify.ts';

// Regression guard for issue #224: router.md must no longer instruct direct writes to
// queue.json/findings-ledger.json, and orchestrator.md must explicitly state serial,
// one-worker-at-a-time mutation application. Modeled on verify.design-track.test.ts /
// verify.test.ts's findMissingGateMarkers usage (required-markers-present shape).

const ROUTER_FIXTURE_FIXED = `
## Write protocol

Single-writer-orchestrator invariant: the router never writes \`queue.json\` or \`findings-ledger.json\` directly.
The router's job ends at computing and returning \`route{}\`, \`trigger\`, and \`local_analyze\` for the orchestrator to apply.
Per that invariant, the orchestrator is the sole writer, applying both mutations serially, post-barrier.
`;

const ROUTER_FIXTURE_STALE = `
## Write protocol

Two state mutations only, both via the \`jq\` read-modify-write + \`.tmp\`/\`mv\` atomic pattern.

1. **\`queue.json\`** — set or update the issue's \`route\` object in its \`issues.<n>\` entry.
2. **\`findings-ledger.json\`** — append one \`routing_decisions\` row, incrementing
   \`next_routing_id\`.

You never use the \`Write\`/\`Edit\`/\`Delete\` tool for these mutations — the same class of
state mutation \`coordinator\`/\`orchestrator\`/\`reviewer\` already perform via bash/\`jq\`.
`;

const ORCHESTRATOR_FIXTURE_FIXED = `
### Triage (idempotent)

For each completed worker:

1. Parse and validate return JSON.
2. Apply queue/ledger mutations per role, serially, one completed worker at a time, even though the batch itself ran in parallel.
   This is the single-writer-orchestrator invariant (\`blackhole-state.md\` § Single-writer invariant).
   For each completed \`router\`, construct the full \`routing_decisions\` row from its returned JSON: assign \`id\` from \`next_routing_id\`, \`issue_ref\` from spawn context, \`created_at\` = now.
`;

const ORCHESTRATOR_FIXTURE_STALE = `
### Triage (idempotent)

For each completed worker:

1. Parse and validate return JSON.
2. Apply queue/ledger mutations per role (router → \`route{}\`; planner → plan gate;
   implementer → PR linkage; reviewer → aggregate pipeline).
`;

describe('ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS', () => {
  test('fixed router.md fixture (returns, does not write) has all markers present', () => {
    expect(findMissingGateMarkers(ROUTER_FIXTURE_FIXED, ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS)).toEqual([]);
  });

  test('stale router.md fixture (pre-fix direct-write instruction) is missing all markers', () => {
    expect(findMissingGateMarkers(ROUTER_FIXTURE_STALE, ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS)).toEqual(
      ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS,
    );
  });
});

describe('ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS', () => {
  test('fixed orchestrator.md fixture (serial, row-construction language) has all markers present', () => {
    expect(
      findMissingGateMarkers(ORCHESTRATOR_FIXTURE_FIXED, ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS),
    ).toEqual([]);
  });

  test('stale orchestrator.md fixture (pre-fix ambiguous "apply mutations") is missing all markers', () => {
    expect(
      findMissingGateMarkers(ORCHESTRATOR_FIXTURE_STALE, ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS),
    ).toEqual(ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS);
  });
});
