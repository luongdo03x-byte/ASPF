import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchController } from '../src/core/batch-controller.js';
import { MemoryStateStore } from '../src/storage/state-store.js';
import { MemoryResultCache } from '../src/storage/result-cache.js';

function makeBatch(){return {id:'b1',name:'demo',status:'READY',currentJobId:null,lastCompletedJobId:null,settings:{mode:'image',outputs:1,maxRetries:2},jobs:[{id:'S01_IMG01',index:1,total:2,sceneId:'S01',imageId:'IMG01',referenceId:null,aspectRatio:'16:9',finalPrompt:'p1',filename:'S01_IMG01.png',status:'PENDING',retryCount:0},{id:'S01_IMG02',index:2,total:2,sceneId:'S01',imageId:'IMG02',referenceId:'S01_IMG01',aspectRatio:'16:9',finalPrompt:'p2',filename:'S01_IMG02.png',status:'PENDING',retryCount:0}]};}

test('controller executes dependency chain, downloads each, completes then clears cache', async()=>{
 const calls=[]; const state=new MemoryStateStore(); const cache=new MemoryResultCache();
 const flow={prepare:async job=>calls.push(`prepare:${job.outputs}`),uploadReference:async f=>calls.push('ref:'+f.name),setPrompt:async p=>calls.push('prompt:'+p),generateAndCapture:async()=>new Blob(['img'],{type:'image/png'})};
 const downloader={save:async(_blob,path)=>calls.push('download:'+path)};
 const c=new BatchController({flow,state,cache,downloader}); const b=makeBatch(); await state.save(b); await c.run(b);
 assert.equal(b.status,'COMPLETED'); assert.deepEqual(b.jobs.map(j=>j.status),['DONE','DONE']); assert.ok(calls.every(x=>!x.startsWith('prepare:')||x==='prepare:1')); assert.ok(calls.some(x=>x==='ref:S01_IMG01.png')); assert.equal(await cache.has('b1','S01_IMG01'),false);
});

test('controller pauses after initial attempt plus two retry failures', async()=>{
 const state=new MemoryStateStore(); const cache=new MemoryResultCache(); let attempts=0;
 const err=()=>Object.assign(new Error('nope'),{retryable:true,code:'GEN_FAIL'});
 const flow={prepare:async()=>{},setPrompt:async()=>{},generateAndCapture:async()=>{attempts++;throw err();}};
 const c=new BatchController({flow,state,cache,downloader:{save:async()=>{}}}); const b=makeBatch(); b.jobs=b.jobs.slice(0,1); await c.run(b);
 assert.equal(attempts,3); assert.equal(b.status,'PAUSED_ERROR'); assert.equal(b.jobs[0].status,'FAILED');
});

test('stop requested during generation is not overwritten by late result', async()=>{
 const state=new MemoryStateStore(); const cache=new MemoryResultCache(); let release; let startedResolve;
 const started=new Promise(r=>startedResolve=r); const gate=new Promise(r=>release=r);
 const flow={prepare:async()=>{},setPrompt:async()=>{},generateAndCapture:async()=>{startedResolve();await gate;return new Blob(['late'],{type:'image/png'});}};
 const c=new BatchController({flow,state,cache,downloader:{save:async()=>{throw new Error('must not download after stop');}}});
 const b=makeBatch(); b.jobs=b.jobs.slice(0,1); const running=c.run(b); await started; c.requestStop(); release(); await running;
 assert.equal(b.status,'STOPPED'); assert.notEqual(b.jobs[0].status,'DONE'); assert.equal(await cache.has('b1','S01_IMG01'),false);
});

test('starting a new run after a previous pause request clears the old pause flag', async()=>{
 const state=new MemoryStateStore(); const cache=new MemoryResultCache();
 const flow={prepare:async()=>{},setPrompt:async()=>{},generateAndCapture:async()=>new Blob(['x'],{type:'image/png'})};
 const c=new BatchController({flow,state,cache,downloader:{save:async()=>{}}}); c.requestPause();
 const b=makeBatch(); b.jobs=b.jobs.slice(0,1); await c.run(b); assert.equal(b.status,'COMPLETED');
});

test('controller logs each retry reason so the first capture failure is not hidden by a later error', async()=>{
 const state=new MemoryStateStore(); const cache=new MemoryResultCache(); let attempts=0; const logs=[];
 const flow={
   prepare:async()=>{},
   setPrompt:async()=>{},
   generateAndCapture:async()=>{
     attempts++;
     const msg=attempts===1?'Generated asset fetch failed: HTTP 403':'Flow send button not found inside the project composer';
     throw Object.assign(new Error(msg),{retryable:true,code:'GEN_FAIL'});
   }
 };
 const c=new BatchController({flow,state,cache,downloader:{save:async()=>{}},onLog:line=>logs.push(line)});
 const b=makeBatch(); b.jobs=b.jobs.slice(0,1); await c.run(b);
 assert.equal(attempts,3);
 assert.ok(logs.some(line=>line.includes('Retry S01_IMG01 1/2')&&line.includes('HTTP 403')));
 assert.ok(logs.some(line=>line.includes('Retry S01_IMG01 2/2')&&line.includes('send button')));
});


test('persists retry logs in batch state so UI does not lose the first failure reason', async()=>{
 const state=new MemoryStateStore(); const cache=new MemoryResultCache(); let attempts=0;
 const flow={
  prepare:async()=>{},setPrompt:async()=>{},
  generateAndCapture:async()=>{attempts++;throw Object.assign(new Error(attempts===1?'capture failed':'send missing'),{retryable:true,code:'GEN_FAIL'});}
 };
 const c=new BatchController({flow,state,cache,downloader:{save:async()=>{}}});
 const b=makeBatch(); b.jobs=b.jobs.slice(0,1); await c.run(b);
 const saved=await state.loadActive();
 assert.ok(saved.logs.some(line=>line.includes('capture failed')));
 assert.ok(saved.logs.some(line=>line.includes('send missing')));
});

test('does not retry a non-retryable post-submit capture failure', async()=>{
 const state=new MemoryStateStore(); const cache=new MemoryResultCache(); let attempts=0;
 const flow={prepare:async()=>{},setPrompt:async()=>{},generateAndCapture:async()=>{attempts++;throw Object.assign(new Error('capture after submit failed'),{retryable:false,stage:'capture',submitted:true,code:'CAPTURE_FAIL'});}};
 const c=new BatchController({flow,state,cache,downloader:{save:async()=>{}}});
 const b=makeBatch(); b.jobs=b.jobs.slice(0,1); await c.run(b);
 assert.equal(attempts,1);
 assert.equal(b.status,'PAUSED_ERROR');
});


test('does not retry after a download failure once the image was already captured', async()=>{
 const state=new MemoryStateStore(); const cache=new MemoryResultCache(); let attempts=0;
 const flow={prepare:async()=>{},setPrompt:async()=>{},generateAndCapture:async()=>{attempts++;return new Blob(['img'],{type:'image/png'});}};
 const downloader={save:async()=>{throw new Error('download exploded');}};
 const c=new BatchController({flow,state,cache,downloader});
 const b=makeBatch(); b.jobs=b.jobs.slice(0,1); await c.run(b);
 assert.equal(attempts,1);
 assert.equal(b.status,'PAUSED_ERROR');
 assert.equal(b.jobs[0].status,'FAILED');
 assert.ok(await cache.has('b1','S01_IMG01'));
});
