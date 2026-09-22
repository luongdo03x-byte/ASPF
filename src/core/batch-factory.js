import { parsePromptBatch } from './parser.js';
import { validateJobs } from './validator.js';
import { BATCH_STATUS } from './constants.js';

function pad(n){return String(n).padStart(2,'0');}
export function timestampForName(date=new Date()){return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;}
export function baseName(filename){return String(filename||'prompts_batch').replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'')||'prompts_batch';}
export function createBatchFromMarkdown(filename,markdown,date=new Date()){
 const jobs=parsePromptBatch(markdown); const validation=validateJobs(jobs); const now=date.toISOString();
 return {id:`${baseName(filename)}-${date.getTime()}`,name:`${baseName(filename)}-${timestampForName(date)}`,sourceFilename:filename,createdAt:now,updatedAt:now,status:validation.valid?BATCH_STATUS.READY:BATCH_STATUS.PAUSED_ERROR,currentJobId:null,lastCompletedJobId:null,settings:{mode:'image',outputs:1,maxRetries:2,model:'Nano Banana Pro'},jobs,validation,logs:[]};
}
export function summarizeBatch(batch){const v=batch.validation??validateJobs(batch.jobs);return {batchId:batch.id,batchName:batch.name,status:batch.status,jobCount:batch.jobs.length,sceneCount:new Set(batch.jobs.map(j=>j.sceneId)).size,doneCount:batch.jobs.filter(j=>j.status==='DONE').length,currentJobId:batch.currentJobId,lastCompletedJobId:batch.lastCompletedJobId,errors:v.errors,warnings:v.warnings,logs:(batch.logs||[]).slice(-12),jobs:batch.jobs.map(j=>({id:j.id,status:j.status,referenceId:j.referenceId,retryCount:j.retryCount,lastError:j.lastError}))};}
