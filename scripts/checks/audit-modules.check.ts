import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { expandVcodeTableKey, parseVcodeTableRows } from '../lib/check-common.ts';
import { parseFrontmatterFields, parseMdFrontmatter } from '../lib/build/content.ts';
import { REVIEWER_AUDIT_MODULE_COUNT, REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT } from '../lib/build/facts.ts';
import { markdownHeadings, sectionEnd } from '../lib/markdown-headings.ts';

// ADR-034 — audit-modules.check.ts: V-AUDIT-01 keeps the reviewer's audit-module registry and
// the `blackhole-vcodes.md` table honest about each other, now that `src/agents/reviewer.md` is
// a shell whose checklist arrives through an `{{INCLUDE:<dir>/*}}` marker naming this
// directory. Each
// module declares the codes it enforces in `vcodes:` frontmatter; nothing else in the build
// reads that field, so without this check a code could be renamed, retired, or moved between
// modules and no compiled artifact would change. Four independently-fallible legs:
//   Leg A (coverage): every code whose table row names `reviewer.md` as its primary enforcement
//   site is claimed by exactly one module — an unclaimed code is an audit that silently stopped
//   being anybody's job; a twice-claimed one is two modules disagreeing about ownership.
//   Leg B (existence): every code a module claims has a row in the table — catches a typo'd or
//   retired id that would otherwise sit in frontmatter looking authoritative forever.
//   Leg C (count): the module directory's file count matches `REVIEWER_AUDIT_MODULE_COUNT`, the
//   declared side of the same declared-fact / independent-scan pair `VCODE_TABLE_ROW_COUNT`
//   uses. This is the leg that fires loudly when the directory is missing or empty rather than
//   letting an absent input read as "nothing to check".
//   Leg D (stub drift, issue #1387): modules whose own first clause is a mechanical gate live in
//   `ONDEMAND_AUDIT_MODULE_DIR` and are NOT inlined; `src/agents/reviewer.md` carries one
//   hand-written stub per module instead. Legs A-C scan both directories, so an on-demand module
//   still owns its codes; Leg D proves each stub names the module's codes, a trigger and the Read
//   path, because a stub that loses any of them silently turns that audit off.

export const AUDIT_MODULE_DIR = 'src/references/audits';
export const ONDEMAND_AUDIT_MODULE_DIR = 'src/references/audit-modules';

// `section` is the module's `section:` frontmatter, the key Leg D matches a stub heading on.
export type AuditModule = { file: string; vcodes: string[]; section?: string };

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

// Leg C — declared module count vs. the directory's own file count. The default arguments name
// the inlined directory; the on-demand directory passes its own constant and path.
export const findAuditModuleCountDrift = (
  declared: number,
  actual: number,
  constName = 'REVIEWER_AUDIT_MODULE_COUNT',
  dir = AUDIT_MODULE_DIR,
): string[] =>
  declared === actual ? [] : [`${constName} declares ${declared} audit modules, ${dir} holds ${actual}`];

export const loadAuditModules = (absDir: string): AuditModule[] =>
  fs.existsSync(absDir)
    ? fs
        .readdirSync(absDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => {
          const content = fs.readFileSync(path.join(absDir, f), 'utf-8');
          return {
            file: f,
            vcodes: parseAuditModuleVcodes(content),
            section: parseFrontmatterFields(parseMdFrontmatter(content).frontmatter)['section'],
          };
        })
    : [];

// A stub heading carries the module's `section:` text, optionally followed by a ` (`V-...`)` code
// suffix, so `§ <Section>` citations resolve against it exactly as they did against the inlined body.
const stubMatchesSection = (headingText: string, section: string): boolean =>
  headingText === section || headingText.startsWith(`${section} (`);

// Every V-code a stub names, compact slash forms (`V-BETA-01/02`) expanded like the table keys.
const codesNamedIn = (text: string): Set<string> =>
  new Set([...text.matchAll(/V-[A-Z0-9-]*[A-Z]-\d+(?:\/\d+)*/g)].flatMap((m) => expandVcodeTableKey(m[0])));

// Leg D — one `###` stub in the reviewer source per on-demand module. Pure over the source text so
// the fixture tests can break each property on its own. `modules` come from `loadAuditModules`.
export const findOnDemandStubDrift = (reviewerSrc: string, modules: AuditModule[]): string[] => {
  const lines = reviewerSrc.split('\n');
  const headings = markdownHeadings(lines).filter((h) => h.level === 3);
  const errors: string[] = [];
  for (const m of modules) {
    if (!m.section) {
      errors.push(`${m.file}: no \`section:\` frontmatter, so its stub cannot be matched`);
      continue;
    }
    const stubs = headings.filter((h) => stubMatchesSection(h.text.replace(/`/g, ''), m.section!));
    if (stubs.length !== 1) {
      errors.push(stubs.length === 0 ? `${m.file}: no stub heading for section "${m.section}" in reviewer.md` : `${m.file}: ${stubs.length} stubs for section "${m.section}" in reviewer.md`);
      continue;
    }
    const body = lines.slice(stubs[0].line, sectionEnd(markdownHeadings(lines), stubs[0], lines.length)).join('\n');
    if (!/\*\*Load when\*\*:/.test(body)) errors.push(`${m.file}: stub has no \`Load when\` trigger line`);
    if (!body.includes(`references/audit-modules/${m.file}`)) errors.push(`${m.file}: stub has no \`Read\` path to references/audit-modules/${m.file}`);
    const named = codesNamedIn(body);
    for (const code of m.vcodes) if (!named.has(code)) errors.push(`${m.file}: stub does not name ${code}`);
  }
  return errors;
};

const checkAuditModules = (): CheckResult => {
  const inline = loadAuditModules(path.join(root, AUDIT_MODULE_DIR));
  const onDemand = loadAuditModules(path.join(root, ONDEMAND_AUDIT_MODULE_DIR));
  const vcodesContent = read('src/references/blackhole-vcodes.md');
  const errors = [
    ...findAuditRegistryDrift([...inline, ...onDemand], reviewerSitedCodes(vcodesContent), documentedCodes(vcodesContent)),
    ...findAuditModuleCountDrift(REVIEWER_AUDIT_MODULE_COUNT, inline.length),
    ...findAuditModuleCountDrift(REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT, onDemand.length, 'REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT', ONDEMAND_AUDIT_MODULE_DIR),
    ...findOnDemandStubDrift(fs.readFileSync(path.join(root, 'src/agents/reviewer.md'), 'utf-8'), onDemand),
  ];
  return errors.length ? { id: 'V-AUDIT-01', ok: false, detail: errors.join('; ') } : { id: 'V-AUDIT-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkAuditModules()];
