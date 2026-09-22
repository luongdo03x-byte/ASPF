import { JOB_STATUS, BATCH_STATUS } from './constants.js';
import { buildDownloadPath } from '../storage/download-manager.js';
import { ExtensionError, asExtensionError } from './errors.js';

export class BatchController {
 constructor({flow,state,cache,downloader,onLog=()=>{}}){this.flow=flow;this.state=state;this.cache=cache;this.downloader=downloader;this.onLog=onLog;this.pauseRequested=false;this.stopRequested=false;}
 async persist(batch){batch.updatedAt=new Date().toISOString();await this.state.save(batch);}
 async log(batch,line){batch.logs=[...(batch.logs||[]),`${new Date().toLocaleTimeString()} ${line}`].slice(-50);await this.persist(batch);await this.onLog(line,batch);}
 async run(batch){this.stopRequested=false;this.pauseRequested=false;batch.status=BATCH_STATUS.RUNNING;await this.persist(batch);for(const job of [...batch.jobs].sort((a,b)=>a.index-b.index)){if(job.status===JOB_STATUS.DONE)continue;if(this.pauseRequested){batch.status=BATCH_STATUS.PAUSED_USER;await this.persist(batch);return batch;} if(job.referenceId){const ref=batch.jobs.find(j=>j.id===job.referenceId);if(ref?.status!=='DONE'||!(await this.cache.has(batch.id,job.referenceId))){job.status=JOB_STATUS.FAILED;job.lastError='Missing dependency blob';batch.status=BATCH_STATUS.PAUSED_ERROR;await this.persist(batch);return batch;}}
   const ok=await this.runJob(batch,job); if(!ok)return batch;
 }
 batch.status=BATCH_STATUS.COMPLETED;batch.currentJobId=null;await this.persist(batch);await this.cache.deleteBatch(batch.id);return batch;}
 async runJob(batch,job){const max=batch.settings?.maxRetries??2;let submitted=false;for(let attempt=0;attempt<=max;attempt++){try{batch.currentJobId=job.id;job.status=JOB_STATUS.PREPARING_FLOW;await this.persist(batch);await this.flow.prepare({...job,outputs:batch.settings?.outputs??1,model:batch.settings?.model||'Nano Banana Pro'});
    if(job.referenceId){job.status=JOB_STATUS.UPLOADING_REFERENCE;await this.persist(batch);const rec=await this.cache.get(batch.id,job.referenceId);if(!rec)throw new ExtensionError('MISSING_DEPENDENCY_BLOB',`Missing ${job.referenceId}`,{retryable:false,stage:'reference'});const file=new File([rec.blob],rec.filename,{type:rec.mimeType});await this.flow.uploadReference(file);}
    job.status=JOB_STATUS.SETTING_PROMPT;await this.persist(batch);await this.flow.setPrompt(job.finalPrompt);
    job.status=JOB_STATUS.GENERATING;await this.persist(batch);const blob=await this.flow.generateAndCapture(job);submitted=true;
    if(this.stopRequested){batch.status=BATCH_STATUS.STOPPED;await this.persist(batch);await this.cache.deleteBatch(batch.id);return false;}
    job.status=JOB_STATUS.CACHING_RESULT;await this.persist(batch);const mimeType=blob.type||'image/png';const ext=mimeType==='image/jpeg'?'jpg':mimeType.split('/')[1]||'png';const filename=`${job.id}.${ext}`;await this.cache.put(batch.id,job.id,{blob,filename,mimeType});
    job.status=JOB_STATUS.DOWNLOADING;await this.persist(batch);await this.downloader.save(blob,buildDownloadPath(batch.name,job.id,mimeType));
    job.filename=filename;job.status=JOB_STATUS.DONE;job.lastError=undefined;batch.lastCompletedJobId=job.id;await this.persist(batch);await this.log(batch,`Done ${job.id}`);return true;
   }catch(e){const err=asExtensionError(e,{code:'JOB_FAILED',retryable:!submitted});if(submitted){err.retryable=false;err.message=err.message||'Post-submit failure';}job.lastError=err.message;if(err.retryable&&attempt<max){job.retryCount=attempt+1;job.status=JOB_STATUS.RETRY_WAIT;await this.persist(batch);await this.log(batch,`Retry ${job.id} ${attempt+1}/${max} after: ${err.message}`);continue;}job.retryCount=attempt;job.status=JOB_STATUS.FAILED;batch.status=BATCH_STATUS.PAUSED_ERROR;await this.persist(batch);await this.log(batch,`Failed ${job.id}: ${err.message}`);return false;}}
 }
 requestPause(){this.pauseRequested=true;}
 requestStop(){this.stopRequested=true;this.pauseRequested=true;}
 async retryFailedJob(batch){if(batch.status!==BATCH_STATUS.PAUSED_ERROR)throw new Error('Batch is not paused on error');const job=batch.jobs.find(j=>j.status===JOB_STATUS.FAILED);if(!job)throw new Error('No failed job');job.retryCount=0;job.lastError=undefined;job.status=JOB_STATUS.PENDING;this.pauseRequested=false;return this.run(batch);}
 async stop(batch){this.requestStop();batch.status=BATCH_STATUS.STOPPED;await this.persist(batch);await this.cache.deleteBatch(batch.id);return batch;}
}
