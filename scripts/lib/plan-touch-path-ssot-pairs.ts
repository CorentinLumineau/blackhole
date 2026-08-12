// Issue #615 — advisory Touch-Paths completeness heuristic: flags documented trigger→companion
// SSOT pairs (V-code row mint → facts.ts / new check module → facts.ts) when the companion path
// is missing from ## Touch-Paths. Pure finder; never a failing_checks entry (#575 precedent).

const looksLikeFilePath = (token: string): boolean =>
  !/\s/.test(token) && (token.includes('/') || /\.[A-Za-z0-9]+$/.test(token));

// V-INT-02: same convention as plan-quality-gate.check.ts — Touch-Paths and Critical Files bullets.
export const extractBacktickPaths = (sectionContent: string): string[] =>
  [...sectionContent.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter(looksLikeFilePath);

export type TouchPathSsotPair = {
  triggerDescription: string;
  companionPath: string;
  constant: string;
  citation: string;
};

export const TOUCH_PATH_SSOT_PAIRS: TouchPathSsotPair[] = [
  {
    triggerDescription: 'src/references/blackhole-vcodes.md with row-add language',
    companionPath: 'scripts/lib/build/facts.ts',
    constant: 'VCODE_TABLE_ROW_COUNT',
    citation: 'V-GROUND-01 / ground-truth.check.ts:85-88',
  },
  {
    triggerDescription: 'new scripts/checks/*.check.ts module',
    companionPath: 'scripts/lib/build/facts.ts',
    constant: 'EXPECTED_CHECK_COUNT',
    citation: 'verify.ts:34-37 / facts.ts:139-145',
  },
];

export type TouchPathSsotGap = {
  missingPath: string;
  reason: string;
};

const VCODE_TRIGGER_PATH = 'src/references/blackhole-vcodes.md';
const FACTS_PATH = 'scripts/lib/build/facts.ts';
const ROW_ADD_LANGUAGE = /\b(mint|new rows?|insert)\b|V-\S*row\b/i;
const CHECK_MODULE_PATH = /^scripts\/checks\/.+\.check\.ts$/;
const NEW_CHECK_MODULE_TEXT =
  /\bnew check module\b|\badd(?:ing)?\s+(?:a\s+)?check\s+module\b|\bnew\s+`scripts\/checks\/[^`]+\.check\.ts`/i;

const vcodesRowAddTriggered = (declared: Set<string>, planBody: string): boolean =>
  declared.has(VCODE_TRIGGER_PATH) && ROW_ADD_LANGUAGE.test(planBody);

const newCheckModuleTriggered = (declared: Set<string>, planBody: string): boolean =>
  [...declared].some((p) => CHECK_MODULE_PATH.test(p)) || NEW_CHECK_MODULE_TEXT.test(planBody);

const gapReason = (pair: TouchPathSsotPair): string =>
  `Missing companion \`${pair.companionPath}\` for ${pair.triggerDescription} (${pair.constant}; ${pair.citation})`;

export const findTouchPathSsotGaps = (
  touchPathsSection: string,
  planBody: string
): TouchPathSsotGap[] => {
  const declared = new Set(extractBacktickPaths(touchPathsSection));
  if (declared.has(FACTS_PATH)) return [];

  const gaps: TouchPathSsotGap[] = [];
  if (vcodesRowAddTriggered(declared, planBody)) {
    gaps.push({ missingPath: FACTS_PATH, reason: gapReason(TOUCH_PATH_SSOT_PAIRS[0]) });
  }
  if (newCheckModuleTriggered(declared, planBody)) {
    const pair = TOUCH_PATH_SSOT_PAIRS[1];
    if (!gaps.some((g) => g.missingPath === pair.companionPath)) {
      gaps.push({ missingPath: pair.companionPath, reason: gapReason(pair) });
    }
  }
  return gaps;
};
