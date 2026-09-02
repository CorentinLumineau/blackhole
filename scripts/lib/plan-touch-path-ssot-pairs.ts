// Advisory Touch-Paths completeness heuristic: flags documented trigger→companion
// SSOT pairs (V-code row mint → facts.ts) when the companion path
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
];

export type TouchPathSsotGap = {
  missingPath: string;
  reason: string;
};

const VCODE_TRIGGER_PATH = 'src/references/blackhole-vcodes.md';
const FACTS_PATH = 'scripts/lib/build/facts.ts';
const ROW_ADD_LANGUAGE = /\b(mint|new rows?|insert)\b|V-\S*row\b/i;

const vcodesRowAddTriggered = (declared: Set<string>, planBody: string): boolean =>
  declared.has(VCODE_TRIGGER_PATH) && ROW_ADD_LANGUAGE.test(planBody);

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
  return gaps;
};
