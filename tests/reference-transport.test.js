import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('reference transport serializes bytes in service worker and rebuilds File in content script', async()=>{
  const worker=await readFile(new URL('../src/background/service-worker.js',import.meta.url),'utf8');
  const content=await readFile(new URL('../src/content/content-script.js',import.meta.url),'utf8');
  assert.match(worker,/serializeReferenceFile/);
  assert.match(worker,/base64:bytesToBase64/);
  assert.match(worker,/FLOW_UPLOAD_REFERENCE,\{reference:/);
  assert.match(content,/referenceToFile/);
  assert.match(content,/new File\(\[bytes\]/);
  assert.match(content,/adapter\.uploadReference\(referenceToFile/);
});
