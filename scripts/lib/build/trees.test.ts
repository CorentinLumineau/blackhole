import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyCursorCloudConfig, CURSOR_CLOUD_TEMPLATE_FILES } from './trees.ts';
import { root } from './paths.ts';

describe('copyCursorCloudConfig', () => {
  test('copies environment.json and settings.json into a fresh cursor root', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-cloud-'));
    try {
      copyCursorCloudConfig(dest);
      for (const file of CURSOR_CLOUD_TEMPLATE_FILES) {
        const copied = fs.readFileSync(path.join(dest, file), 'utf-8');
        const source = fs.readFileSync(path.join(root, 'templates', 'cursor-cloud', file), 'utf-8');
        expect(copied).toBe(source);
      }
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});
