import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionForMime, buildDownloadPath } from '../src/storage/download-manager.js';

test('uses real mime extension and sanitized batch path', () => {
  assert.equal(extensionForMime('image/jpeg'),'jpg');
  assert.equal(extensionForMime('image/webp'),'webp');
  assert.equal(buildDownloadPath('a/b','S01_IMG01','image/png'),'FlowBatch/a-b/S01_IMG01.png');
});
