import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import { DETECT_FRONTEND_SCRIPT, isFrontendPath, loadFrontendPathSet, parseFrontendPathSet } from './frontend-paths.ts';

describe('frontend path set (derived from scripts/detect-frontend.sh)', () => {
  const set = loadFrontendPathSet();

  test('drift: every keyword the script names is in the derived set', () => {
    const script = fs.readFileSync(DETECT_FRONTEND_SCRIPT, 'utf-8');
    // Independent scan of the script's quoted/word tokens, not the parser's own regexes.
    for (const ext of ['tsx', 'vue', 'svelte', 'jsx']) {
      expect(script.includes(`'*.${ext}'`)).toBe(true);
      expect(set.extensions).toContain(ext);
    }
    for (const d of ['src/components', 'app/components', 'apps/web', 'pages', 'views', 'public']) expect(set.uiDirs).toContain(d);
    expect(set.rootFiles).toEqual(['index.html']);
    for (const c of ['tailwind.config.ts', 'postcss.config.js', 'vite.config.ts', 'next.config.mjs', 'nuxt.config.ts']) expect(set.configNames).toContain(c);
  });

  test('a keyword added to the script is picked up without touching this module', () => {
    const edited = fs.readFileSync(DETECT_FRONTEND_SCRIPT, 'utf-8').replace("-name '*.vue'", "-name '*.vue' -o -name '*.astro'").replace('for cfg in ', 'for cfg in astro.config.mjs ');
    const next = parseFrontendPathSet(edited);
    expect(next.extensions).toContain('astro');
    expect(isFrontendPath('src/Page.astro', next)).toBe(true);
    expect(isFrontendPath('astro.config.mjs', next)).toBe(true);
  });

  test('a script that no longer yields every keyword group fails loudly', () => {
    const tmp = `${process.env.TMPDIR ?? '/tmp'}/fp-${process.pid}.sh`;
    fs.writeFileSync(tmp, '#!/usr/bin/env bash\necho frontend=no\n');
    try {
      expect(() => loadFrontendPathSet(tmp)).toThrow('could not read every keyword group');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  test('matches UI extensions, UI directories, root index.html and config names; rejects backend paths', () => {
    expect(isFrontendPath('src/App.tsx', set)).toBe(true);
    expect(isFrontendPath('apps/web/server.ts', set)).toBe(true);
    expect(isFrontendPath('public/logo.png', set)).toBe(true);
    expect(isFrontendPath('index.html', set)).toBe(true);
    expect(isFrontendPath('packages/ui/tailwind.config.ts', set)).toBe(true);
    expect(isFrontendPath('scripts/build.ts', set)).toBe(false);
    expect(isFrontendPath('docs/index.html', set)).toBe(false);
    expect(isFrontendPath('src/publicity.ts', set)).toBe(false);
  });
});
