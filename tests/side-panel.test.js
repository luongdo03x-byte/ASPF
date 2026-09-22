import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { configureSidePanel } from '../src/background/side-panel.js';
import { readPromptFile } from '../src/ui/import-helpers.js';

test('manifest uses a persistent side panel instead of an action popup', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.side_panel?.default_path, 'ui/panel.html');
  assert.equal(manifest.action?.default_popup, undefined);
});

test('configures toolbar action to open the side panel', async () => {
  const calls = [];
  const chromeApi = {
    sidePanel: {
      setPanelBehavior: async options => calls.push(options)
    }
  };

  await configureSidePanel(chromeApi);
  assert.deepEqual(calls, [{ openPanelOnActionClick: true }]);
});

test('reads the supplied markdown file from a persistent extension page', async () => {
  const file = new File(['# Prompt batch\n\n## [1/1] S01_IMG01 — không cần ảnh tham chiếu'], 'prompts_batch.md', { type: 'text/markdown' });
  const result = await readPromptFile(file);
  assert.equal(result.filename, 'prompts_batch.md');
  assert.match(result.markdown, /S01_IMG01/);
});

test('rejects empty or wrong-format imports with an actionable message', async () => {
  const empty = new File(['   '], 'prompts_batch.md', { type: 'text/markdown' });
  await assert.rejects(() => readPromptFile(empty), /empty/i);

  const wrong = new File(['hello'], 'prompts_batch.json', { type: 'application/json' });
  await assert.rejects(() => readPromptFile(wrong), /\.md/i);
});


test('imports the exact supplied prompts_batch.md into a ready 42-job batch', async () => {
  const { createBatchFromMarkdown, summarizeBatch } = await import('../src/core/batch-factory.js');
  const source = await fs.readFile(new URL('./fixtures/prompts_batch.md', import.meta.url), 'utf8');
  const file = new File([source], 'prompts_batch.md', { type: 'text/markdown' });
  const payload = await readPromptFile(file);
  const batch = createBatchFromMarkdown(payload.filename, payload.markdown, new Date('2026-09-22T06:00:00Z'));
  const summary = summarizeBatch(batch);
  assert.equal(summary.status, 'READY');
  assert.equal(summary.jobCount, 42);
  assert.equal(summary.sceneCount, 14);
  assert.equal(summary.errors.length, 0);
});
