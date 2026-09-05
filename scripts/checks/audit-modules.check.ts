import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { expandVcodeTableKey, parseVcodeTableRows } from '../lib/check-common.ts';
import { parseFrontmatterFields, parseMdFrontmatter } from '../lib/build/content.ts';
import { REVIEWER_AUDIT_MODULE_COUNT } from '../lib/build/facts.ts';

// ADR-034 — audit-modules.check.ts: V-AUDIT-01 keeps the reviewer's audit-module registry and
// the `blackhole-vcodes.md` table honest about each other, now that `src/agents/reviewer.md` is
// a shell whose checklist arrives through an `{{INCLUDE:<dir>/*}}` marker naming this
// directory. Each
// module declares the codes it enforces in `vcodes:` frontmatter; nothing else in the build
// reads that field, so without this check a code could be renamed, retired, or moved between
// modules and no compiled artifact would change. Three independently-fallible legs:
//   Leg A (coverage): every code whose table row names `reviewer.md` as its primary enforcement
//   site is claimed by exactly one module — an unclaimed code is an audit that silently stopped
//   being anybody's job; a twice-claimed one is two modules disagreeing about ownership.
//   Leg B (existence): every code a module claims has a row in the table — catches a typo'd or
//   retired id that would otherwise sit in frontmatter looking authoritative forever.
//   Leg C (count): the module directory's file count matches `REVIEWER_AUDIT_MODULE_COUNT`, the
//   declared side of the same declared-fact / independent-scan pair `VCODE_TABLE_ROW_COUNT`
//   uses. This is the leg that fires loudly when the directory is missing or empty rather than
//   letting an absent input read as "nothing to check".

export const AUDIT_MODULE_DIR = 'src/references/audits';

export type AuditModule = { file: string; vcodes: string[] };

// `vcodes: [V-A-01, V-B-02]` — a YAML flow sequence, parsed with the same trim-and-split idiom
// the rest of the check layer uses for inline lists rather than pulling in a YAML dependency for
// one field shape. A module with no `vcodes:` key yields an empty list, which Leg A then reports
// as unclaimed codes rather than passing vacuously.
export const parseAuditModuleVcodes = (content: string): string[] => {
  const raw = parseFrontmatterFields(parseMdFrontmatter(content).frontmatter)['vcodes'] ?? '';
  return raw.replace(/^\[/, '').replace(/\]$/, '').split(',').map((c) => c.trim()).filter(Boolean);
};

// The reviewer-sited half of the table: a row whose `Primary enforcement site` cell names
// `reviewer.md` anywhere, so a compound site (`implementer.md § … + reviewer.md § …`) counts —
// the reviewer still owns a leg of it and a module still has to declare it.
export const reviewerSitedCodes = (vcodesContent: string): string[] =>
  parseVcodeTableRows(vcodesContent)
    .filter((r) => r.site.includes('reviewer.md'))
    .flatMap((r) => expandVcodeTableKey(r.code));

export const documentedCodes = (vcodesContent: string): string[] =>
  parseVcodeTableRows(vcodesContent).flatMap((r) => expandVcodeTableKey(r.code));

// Leg A + Leg B over an already-parsed module set, kept pure so the fixture tests can drive it
// with a deliberately broken registry the live tree would never contain.
export const findAuditRegistryDrift = (
  modules: AuditModule[],
  sitedCodes: string[],
  tableCodes: string[],
): string[] => {
  const owners = new Map<string, string[]>();
  for (const m of modules) {
    for (const code of m.vcodes) owners.set(code, [...(owners.get(code) ?? []), m.file]);
  }
  const known = new Set(tableCodes);

  const unclaimed = sitedCodes
    .filter((c) => !owners.has(c))
    .map((c) => `${c}: reviewer-sited but claimed by no audit module`);
  const contested = [...owners.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([c, files]) => `${c}: claimed by ${files.length} modules (${files.join(', ')})`);
  const unknown = [...owners.entries()]
    .filter(([c]) => !known.has(c))
    .map(([c, files]) => `${c}: listed by ${files.join(', ')} but absent from the V-code table`);

  return [...unclaimed, ...contested, ...unknown];
};

// Leg C — declared module count vs. the directory's own file count.
export const findAuditModuleCountDrift = (declared: number, actual: number): string[] =>
  declared === actual
    ? []
    : [`REVIEWER_AUDIT_MODULE_COUNT declares ${declared} audit modules, ${AUDIT_MODULE_DIR} holds ${actual}`];

export const loadAuditModules = (absDir: string): AuditModule[] =>
  fs.existsSync(absDir)
    ? fs
        .readdirSync(absDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => ({ file: f, vcodes: parseAuditModuleVcodes(fs.readFileSync(path.join(absDir, f), 'utf-8')) }))
    : [];

const checkAuditModules = (): CheckResult => {
  const modules = loadAuditModules(path.join(root, AUDIT_MODULE_DIR));
  const vcodesContent = read('src/references/blackhole-vcodes.md');
  const errors = [
    ...findAuditRegistryDrift(modules, reviewerSitedCodes(vcodesContent), documentedCodes(vcodesContent)),
    ...findAuditModuleCountDrift(REVIEWER_AUDIT_MODULE_COUNT, modules.length),
  ];
  return errors.length ? { id: 'V-AUDIT-01', ok: false, detail: errors.join('; ') } : { id: 'V-AUDIT-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkAuditModules()];
