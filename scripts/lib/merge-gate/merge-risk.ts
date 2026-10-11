// merge-gate.md § 9 — whether a green campaign PR is low-risk enough for blackhole to squash-merge
// itself. Pure function of the PR's changed files (and optional patches / head ref); the
// label, comment, and `gh pr merge` call stay in phase-loop.md.

export const RISK_CATEGORIES = [
  'auth-login',
  'secrets-env',
  'prod-db',
  'migrations',
  'github-workflows',
  'release-tag',
  'deletes-data',
] as const;

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const NEEDS_CHEF_LABEL = 'needs-chef';
export const NEEDS_CHEF_COMMENT_PREFIX = 'needs-chef:';

const CATEGORY_LABEL: Record<RiskCategory, string> = {
  'auth-login': 'auth/login',
  'secrets-env': 'secrets or env',
  'prod-db': 'prod DB',
  migrations: 'migrations',
  'github-workflows': '.github/workflows',
  'release-tag': 'release/tag tooling',
  'deletes-data': 'deletes data',
};

export type ChangedFile = {
  path: string;
  status: string;
  previousPath?: string;
};

export type FilePatch = { path: string; patch: string };

export type MergeRiskReason = { category: RiskCategory; paths: string[] };

export type MergeRiskVerdict = {
  low_risk: boolean;
  own_pr: boolean;
  automerge: boolean;
  reasons: MergeRiskReason[];
  comment: string;
};

const posix = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

export const isTestPath = (p: string): boolean =>
  /(^|\/)(test|tests|__tests__|spec|fixtures)\//i.test(p) || /\.(test|spec)\.[jt]sx?$/.test(p);

type PathRule = { category: RiskCategory; test: (p: string) => boolean };

const PATH_RULES: PathRule[] = [
  {
    category: 'auth-login',
    test: (p) =>
      /(^|\/)(auth|login|signin|sign-in|oauth|sso|passport)(\/|$)/i.test(p) ||
      /(^|\/)[^/]*(login|oauth|password|jwt)[^/]*$/i.test(p),
  },
  {
    category: 'secrets-env',
    test: (p) =>
      /(^|\/)\.env(\.|$)/i.test(p) ||
      /(^|\/)(secrets?|credentials)(\.|\/|$)/i.test(p) ||
      /\.(pem|key|p12|pfx)$/i.test(p) ||
      /(^|\/)\.ssh\//i.test(p) ||
      /(^|\/)\.aws\/credentials$/i.test(p) ||
      /(^|\/)(id_rsa|id_ed25519)/i.test(p) ||
      /(^|\/)\.(npmrc|pypirc|netrc)$/i.test(p),
  },
  {
    category: 'prod-db',
    test: (p) =>
      /(prod|production).*(db|database|sql|postgres|mysql|mongo)/i.test(p) ||
      /(db|database|sql|postgres|mysql|mongo).*(prod|production)/i.test(p),
  },
  {
    category: 'migrations',
    test: (p) =>
      /(^|\/)migrations?\//i.test(p) ||
      /(^|\/)migrate\//i.test(p) ||
      /(^|\/)alembic\//i.test(p) ||
      /prisma\/migrations\//i.test(p) ||
      /drizzle\/.+\.sql$/i.test(p) ||
      /(^|\/)(knexfile|flyway)/i.test(p),
  },
  {
    category: 'github-workflows',
    test: (p) => /^\.github\/workflows\//.test(p),
  },
  {
    category: 'release-tag',
    test: (p) =>
      /(^|\/)scripts\/release\.ts$/i.test(p) ||
      /^\.github\/releases\//.test(p) ||
      /(^|\/)(git-create-release|prj-create-release)\//i.test(p) ||
      /(^|\/)(\.releaserc|release-please|semantic-release)/i.test(p) ||
      /(^|\/)release\.ts$/i.test(p),
  },
];

const DATA_DIR = /(^|\/)(data|dumps?|backups?|seeds?)\//i;
const DATA_EXT = /\.(sql|dump|csv)$/i;
const DESTRUCTIVE_SQL = /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE(\s+TABLE)?|DELETE\s+FROM)\b/i;

/** True when `headRef` is a campaign worker branch (`blackhole/issue-N`). Absent/empty is treated
 * as own-PR: the merge protocol already only considers campaign issues. */
export const isBlackholeCampaignBranch = (headRef?: string | null): boolean => {
  if (!headRef) return true;
  const name = headRef.replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  return /^blackhole\/issue-\d+$/.test(name);
};

export const filesFromNameStatus = (text: string): ChangedFile[] => {
  const files: ChangedFile[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0] ?? '';
    const status = code.charAt(0);
    if ((status === 'R' || status === 'C') && parts.length >= 3) {
      files.push({ path: parts[2], status, previousPath: parts[1] });
    } else if (parts.length >= 2) {
      files.push({ path: parts[1], status });
    }
  }
  return files;
};

/** Splits a `git diff` / `gh pr diff` unified patch into per-file hunks. A blob with no
 * `diff --git` headers is one patch at path `(patch)` so a raw SQL snippet still classifies. */
export const patchesFromUnifiedDiff = (text: string): FilePatch[] => {
  const patches: FilePatch[] = [];
  let currentPath: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    if (currentPath !== null) patches.push({ path: currentPath, patch: buf.join('\n') });
    buf = [];
  };
  for (const line of text.split('\n')) {
    const git = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (git) {
      flush();
      currentPath = git[2];
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  if (currentPath !== null) {
    flush();
  } else if (text.trim()) {
    patches.push({ path: '(patch)', patch: text });
  }
  return patches;
};

const versionChanged = (patch: string): boolean => {
  const minus = /^-.*["']version["']\s*:/m.test(patch);
  const plus = /^\+.*["']version["']\s*:/m.test(patch);
  return minus && plus;
};

const addPath = (bucket: Map<RiskCategory, string[]>, category: RiskCategory, path: string): void => {
  const list = bucket.get(category) ?? [];
  if (!list.includes(path)) list.push(path);
  bucket.set(category, list);
};

export const buildNeedsChefComment = (opts: {
  own_pr: boolean;
  headRef?: string | null;
  reasons: MergeRiskReason[];
}): string => {
  const lines = [
    `${NEEDS_CHEF_COMMENT_PREFIX} left open for Chef (orchestrator) — not eligible for autonomous squash-merge.`,
    '',
  ];
  if (!opts.own_pr) {
    lines.push(
      `- not a blackhole campaign PR (head is \`${opts.headRef}\`, expected \`blackhole/issue-N\`)`,
    );
  }
  for (const reason of opts.reasons) {
    lines.push(`- touches ${CATEGORY_LABEL[reason.category]}: ${reason.paths.join(', ')}`);
  }
  return lines.join('\n').trimEnd() + '\n';
};

export const classifyMergeRisk = (input: {
  files: ChangedFile[];
  patches?: FilePatch[];
  headRef?: string | null;
}): MergeRiskVerdict => {
  const bucket = new Map<RiskCategory, string[]>();

  for (const file of input.files) {
    const paths = [file.path, file.previousPath].filter((p): p is string => Boolean(p)).map(posix);
    for (const p of paths) {
      for (const rule of PATH_RULES) {
        if (rule.test(p)) addPath(bucket, rule.category, p);
      }
      if (file.status.startsWith('D') && !isTestPath(p) && (DATA_DIR.test(p) || DATA_EXT.test(p))) {
        addPath(bucket, 'deletes-data', p);
      }
    }
  }

  for (const patch of input.patches ?? []) {
    const p = posix(patch.path);
    if (isTestPath(p)) continue;
    if (DESTRUCTIVE_SQL.test(patch.patch)) addPath(bucket, 'deletes-data', p);
    if (/(^|\/)package\.json$/.test(p) && versionChanged(patch.patch)) addPath(bucket, 'release-tag', p);
  }

  const reasons: MergeRiskReason[] = RISK_CATEGORIES.filter((c) => bucket.has(c)).map((category) => ({
    category,
    paths: bucket.get(category) ?? [],
  }));
  const own_pr = isBlackholeCampaignBranch(input.headRef);
  const low_risk = reasons.length === 0;
  return {
    low_risk,
    own_pr,
    automerge: low_risk && own_pr,
    reasons,
    comment: buildNeedsChefComment({ own_pr, headRef: input.headRef, reasons }),
  };
};

export const parseMergeRiskSnapshot = (raw: unknown): { files: ChangedFile[]; patches?: FilePatch[]; headRef?: string } => {
  if (raw === null || typeof raw !== 'object') throw new Error('merge-risk snapshot must be an object');
  const snap = raw as { files?: unknown; patches?: unknown; headRef?: unknown };
  if (!Array.isArray(snap.files)) throw new Error('merge-risk snapshot.files must be an array');
  const files = snap.files.map((entry, i) => {
    if (entry === null || typeof entry !== 'object') throw new Error(`files[${i}] must be an object`);
    const f = entry as { path?: unknown; status?: unknown; previousPath?: unknown };
    if (typeof f.path !== 'string' || typeof f.status !== 'string') {
      throw new Error(`files[${i}] needs string path and status`);
    }
    return {
      path: f.path,
      status: f.status,
      ...(typeof f.previousPath === 'string' ? { previousPath: f.previousPath } : {}),
    };
  });
  const patches = Array.isArray(snap.patches)
    ? snap.patches.map((entry, i) => {
        if (entry === null || typeof entry !== 'object') throw new Error(`patches[${i}] must be an object`);
        const p = entry as { path?: unknown; patch?: unknown };
        if (typeof p.path !== 'string' || typeof p.patch !== 'string') {
          throw new Error(`patches[${i}] needs string path and patch`);
        }
        return { path: p.path, patch: p.patch };
      })
    : undefined;
  const headRef = typeof snap.headRef === 'string' ? snap.headRef : undefined;
  return { files, patches, headRef };
};
