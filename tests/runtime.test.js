import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBatchFromMarkdown, summarizeBatch } from '../src/core/batch-factory.js';
import { reconcileBatchForResume } from '../src/background/runtime-helpers.js';

test('creates named ready batch from supplied markdown', async()=>{
 const md=await readFile(new URL('./fixtures/prompts_batch.md',import.meta.url),'utf8');
 const batch=createBatchFromMarkdown('prompts_batch.md',md,new Date('2026-09-22T04:27:00Z'));
 assert.equal(batch.status,'READY'); assert.equal(batch.jobs.length,42); assert.match(batch.name,/prompts_batch-20260922-/);
 const summary=summarizeBatch(batch); assert.equal(summary.jobCount,42); assert.equal(summary.sceneCount,14); assert.equal(summary.errors.length,0);
});

test('resume reconciliation resets uncertain active state to pending', async()=>{
 const batch={status:'RUNNING',jobs:[{id:'S01_IMG01',status:'GENERATING',referenceId:null}]};
 const out=await reconcileBatchForResume(batch,{has:async()=>true});
 assert.equal(out.jobs[0].status,'PENDING'); assert.equal(out.status,'READY');
});

test('resume reconciliation pauses when unfinished job needs missing cached dependency', async()=>{
 const batch={status:'RUNNING',currentJobId:'S01_IMG02',jobs:[{id:'S01_IMG01',status:'DONE',referenceId:null},{id:'S01_IMG02',status:'PENDING',referenceId:'S01_IMG01'}]};
 const out=await reconcileBatchForResume(batch,{has:async()=>false});
 assert.equal(out.status,'PAUSED_ERROR'); assert.equal(out.jobs[1].status,'FAILED'); assert.match(out.jobs[1].lastError,/Missing cached dependency/);
});
