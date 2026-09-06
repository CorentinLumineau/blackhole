import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { expandVcodeTableKey, parseVcodeTableRows } from '../lib/check-common.ts';
import { MERCURE_VCODE_SNAPSHOT_STALE_DAYS } from '../lib/build/facts.ts';
import { readJsonFile } from '../lib/fs.ts';

// Issue #869 (plan Design Decisions D1) — mechanizes V-code severity parity against mercure by
// diffing blackhole's own src/references/blackhole-vcodes.md table against a vendored snapshot
// of mercure's severity tables (documentation/audits/mercure-vcode-snapshot.json, produced by
// scripts/lib/mercure-vcode-snapshot.ts). Advisory only (WARN, both codes) — the snapshot can
// only assert "as of the last sync"; see `.blackhole/plans/issue-869-analysis.md` for why a live
// cross-repo parse cannot be a `bun run verify` gate (CorentinLumineau/mercure is a private repo
// with no cross-repo CI credential, and GitHub Actions would not forward one to a fork-triggered
// pull_request run regardless).
//
// File-absent SKIP is binding, same precedent as parity-matrix.check.ts's checkParityMatrix /
// V-PMATRIX-01 (`if (!fs.existsSync(...)) return { ok: true }`): the snapshot only exists once a
// maintainer runs the sync script by hand.

const SNAPSHOT_PATH = path.join(root, 'documentation', 'audits', 'mercure-vcode-snapshot.json');

type MercureVcodeSnapshotFile = {
  synced_at: string;
  codes: Record<string, { severity: string; description: string }>;
};

// D1's tier-collapse mapping: blackhole's severity column is binary (BLOCK/WARN); mercure's is
// four-tier (CRITICAL/HIGH/MEDIUM/LOW). CRITICAL|HIGH -> BLOCK, MEDIUM|LOW -> WARN (blackhole has
// no INFO tier, so LOW collapses into WARN exactly as MEDIUM does). A raw string comparison
// ("LOW" !== "WARN") would flag every shared code as a false "disagreement" — see plan Design
// Decisions D1 for the full table this mapping reproduces as a consequence, not an exclude list.
export const mapMercureSeverityToBlackholeAction = (mercureSeverity: string): 'BLOCK' | 'WARN' =>
  mercureSeverity === 'CRITICAL' || mercureSeverity === 'HIGH' ? 'BLOCK' : 'WARN';

// One named, cited, removable allowlist (same shape as vcode-severity-sync.check.ts's
// KNOWN_SEVERITY_EXEMPTIONS, V-INT-01) — the two codes plan Design Decisions D1 identified as
// genuine, already-documented severity disagreements under the correct tier mapping.
export const KNOWN_VCODE_PARITY_DIVERGENCES: { code: string; reason: string }[] = [
  { code: 'V-ADA-05', reason: 'mercure HIGH ("AGENTS.md -> CLAUDE.md symlink integrity") vs blackhole WARN — ADR-021 D5 / ADR-024 D4: documented, not renumbered (plan Design Decisions D2)' },
  { code: 'V-DOC-GOV-01', reason: 'mercure HIGH vs blackhole WARN by deliberate design (blackhole-vcodes.md row note: reviewer judgment audit, escalatable via docs_governance.severity_overrides)' },
];

/**
 * Compares two shared-key severity maps under the D1 tier mapping. Only ids present in *both*
 * maps are considered (an id present in only one map is not a parity question at all — it has
 * no counterpart to disagree with). A mismatch on an allowlisted id is suppressed; a mismatch on
 * a non-shared id never arises in the first place, allowlisted or not.
 */
export const findVcodeParityMismatches = (
  mercureMap: Map<string, string>,
  blackholeSevMap: Map<string, string>,
  allowlist: { code: string; reason: string }[],
): { code: string; mercureSeverity: string; mappedAction: string; blackholeAction: string }[] => {
  const allowlisted = new Set(allowlist.map((d) => d.code));
  const mismatches: { code: string; mercureSeverity: string; mappedAction: string; blackholeAction: string }[] = [];

  for (const [code, mercureSeverity] of mercureMap) {
    if (!blackholeSevMap.has(code) || allowlisted.has(code)) continue;
    const mappedAction = mapMercureSeverityToBlackholeAction(mercureSeverity);
    const blackholeAction = blackholeSevMap.get(code) as string;
    if (mappedAction !== blackholeAction) {
      mismatches.push({ code, mercureSeverity, mappedAction, blackholeAction });
    }
  }
  return mismatches;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A `syncedAt` strictly more than `thresholdDays` before `now` is stale; boundary-equal is not. */
export const findSnapshotStaleness = (syncedAt: string, thresholdDays: number, now: Date): boolean =>
  now.getTime() - new Date(syncedAt).getTime() > thresholdDays * MS_PER_DAY;

const checkVcodeParitySeverity = (mercureMap: Map<string, string>, blackholeSevMap: Map<string, string>): CheckResult => {
  const mismatches = findVcodeParityMismatches(mercureMap, blackholeSevMap, KNOWN_VCODE_PARITY_DIVERGENCES);
  if (mismatches.length === 0) return { id: 'V-MPARITY-01', ok: true };
  return {
    id: 'V-MPARITY-01',
    ok: false,
    detail: mismatches
      .map((m) => `${m.code}: mercure ${m.mercureSeverity} (maps to ${m.mappedAction}) vs blackhole ${m.blackholeAction}`)
      .join('; '),
  };
};

const checkVcodeParityStaleness = (syncedAt: string): CheckResult => {
  if (!findSnapshotStaleness(syncedAt, MERCURE_VCODE_SNAPSHOT_STALE_DAYS, new Date())) {
    return { id: 'V-MPARITY-02', ok: true };
  }
  return {
    id: 'V-MPARITY-02',
    ok: false,
    detail: `documentation/audits/mercure-vcode-snapshot.json synced_at (${syncedAt}) is older than ${MERCURE_VCODE_SNAPSHOT_STALE_DAYS} days — re-run scripts/lib/mercure-vcode-snapshot.ts`,
  };
};

// V-MPARITY-01/02: advisory-only parity check (WARN). File-absent SKIP: the snapshot is a
// maintainer-produced artifact (prj-mercure-sync), not created by `bun run verify` itself.
const checkVcodeParity = (): CheckResult[] => {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    return [{ id: 'V-MPARITY-01', ok: true }, { id: 'V-MPARITY-02', ok: true }];
  }

  const snapshot = readJsonFile(SNAPSHOT_PATH, SNAPSHOT_PATH) as MercureVcodeSnapshotFile;
  const mercureMap = new Map(Object.entries(snapshot.codes).map(([code, row]) => [code, row.severity]));

  const vcodesContent = fs.readFileSync(path.join(root, 'src/references/blackhole-vcodes.md'), 'utf-8');
  const blackholeSevMap = new Map<string, string>();
  for (const row of parseVcodeTableRows(vcodesContent)) {
    for (const code of expandVcodeTableKey(row.code)) blackholeSevMap.set(code, row.severity);
  }

  return [checkVcodeParitySeverity(mercureMap, blackholeSevMap), checkVcodeParityStaleness(snapshot.synced_at)];
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => checkVcodeParity();
