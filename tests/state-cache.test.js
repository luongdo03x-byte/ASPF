import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStateStore } from '../src/storage/state-store.js';
import { MemoryResultCache } from '../src/storage/result-cache.js';

test('state store persists an independent batch snapshot', async () => {
  const store=new MemoryStateStore();
  const batch={id:'b1',status:'RUNNING',jobs:[]};
  await store.save(batch); batch.status='STOPPED';
  assert.equal((await store.loadActive()).status,'RUNNING');
});

test('result cache stores and deletes per-batch blobs', async () => {
  const cache=new MemoryResultCache();
  const blob=new Blob(['x'],{type:'image/png'});
  await cache.put('b1','S01_IMG01',{blob,filename:'S01_IMG01.png',mimeType:'image/png'});
  assert.equal(await cache.has('b1','S01_IMG01'),true);
  await cache.deleteBatch('b1');
  assert.equal(await cache.has('b1','S01_IMG01'),false);
});
