import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePromptBatch } from '../src/core/parser.js';

test('parses supplied 42 prompt markdown and reference chain', async () => {
  const md = await readFile(new URL('./fixtures/prompts_batch.md', import.meta.url), 'utf8');
  const jobs = parsePromptBatch(md);
  assert.equal(jobs.length, 42);
  assert.equal(new Set(jobs.map(j => j.sceneId)).size, 14);
  assert.equal(jobs[0].id, 'S01_IMG01');
  assert.equal(jobs[0].referenceId, null);
  assert.equal(jobs[1].referenceId, 'S01_IMG01');
  assert.equal(jobs[2].referenceId, 'S01_IMG02');
  assert.equal(jobs[1].minWidth, 3072);
  assert.equal(jobs[0].aspectRatio, '16:9');
  assert.match(jobs[0].finalPrompt, /style lock/);
  assert.match(jobs[0].finalPrompt, /negative/);
});
