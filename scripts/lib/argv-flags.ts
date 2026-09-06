// The one shared `argv → flags` / `flags → required string` pair. Ported verbatim from
// scripts/stack-repair.ts:187-204's private parseFlags/requireFlag, the seed 15 scripts/** CLI
// entrypoints each independently hand-rolled an equivalent ~10-line loop for (V-INT-02/V-DRY-01).
// Pure functions only — no I/O, no process.exit: usage-printing and exit-code selection are a
// per-call-site policy that stays at each of those 15 sites, since their exit-code conventions
// diverge (2; 1-then-2; 0/1/2/3; boolean-only) and centralizing that choice here would need a
// parameter for every site's own convention, which is strictly more coupling for no benefit
// (V-KISS-01). `scripts/stack-repair.ts` itself is not migrated to import this module in the
// same PR that introduces it (out of scope — a disclosed, deliberate scope boundary, not an
// oversight), so its own copy remains a disclosed 16th duplicate pending a fast-follow.

export type Flags = Record<string, string | true>;

// The `!next.startsWith('--')` check is the load-bearing fix: a flag immediately followed by
// another flag name (e.g. `--entity-key --live <path>`) binds as boolean `true` instead of
// silently swallowing the next flag's name as a string value.
export const parseFlags = (argv: string[]): Flags => {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
};

export const requireFlag = (flags: Flags, name: string): string => {
  const value = flags[name];
  if (typeof value !== 'string') throw new Error(`missing required flag --${name}`);
  return value;
};

// A fixed-stride `for (i = 2; i < argv.length; i += 2)` loop structurally rejects any token
// outside a clean --key/value alternation — including a syntactically fine but unrecognized
// flag — by calling usage() as soon as the shape breaks. parseFlags has no such structural
// check: an unrecognized token just becomes an unused Flags entry. Call sites that need the
// old rejection back call this explicitly with their own known-key list and their own usage().
// Optional, not folded into parseFlags itself, for the same reason exit-code selection stays
// per-call-site (V-KISS-01): a lookahead-shape site that never rejected unknown flags before
// this module existed must not gain new rejection behavior it never had (that would be an
// undisclosed change in the opposite direction).
export const unknownFlagKeys = (flags: Flags, knownKeys: string[]): string[] => {
  const known = new Set(knownKeys);
  return Object.keys(flags).filter((key) => !known.has(key));
};
