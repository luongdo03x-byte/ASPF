import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJobs } from '../src/core/validator.js';
import { findNextRunnableJob } from '../src/core/queue.js';

const job=(id,index,referenceId=null,status='PENDING')=>({id,index,total:3,sceneId:id.split('_')[0],imageId:id.split('_')[1],referenceId,minWidth:4608,aspectRatio:'16:9',mainPrompt:'x',styleLock:'s',negativePrompt:'n',finalPrompt:'x',filename:id+'.png',status,retryCount:0});

test('validator rejects missing and forward references', () => {
  const missing = validateJobs([job('S01_IMG01',1,'NOPE')]);
  assert.ok(missing.errors.some(e=>e.code==='MISSING_REFERENCE'));
  const forward = validateJobs([job('S01_IMG01',1,'S01_IMG02'),job('S01_IMG02',2)]);
  assert.ok(forward.errors.some(e=>e.code==='FORWARD_REFERENCE'));
});

test('queue only returns jobs with completed cached dependency', () => {
  const jobs=[job('S01_IMG01',1,null,'DONE'),job('S01_IMG02',2,'S01_IMG01'),job('S01_IMG03',3,'S01_IMG02')];
  assert.equal(findNextRunnableJob(jobs,new Set(['S01_IMG01'])).id,'S01_IMG02');
  assert.equal(findNextRunnableJob(jobs,new Set()), undefined);
});
