import { MSG, BATCH_STATUS, JOB_STATUS } from '../core/constants.js';
import { ExtensionError } from '../core/errors.js';
import { createBatchFromMarkdown, summarizeBatch } from '../core/batch-factory.js';
import { BatchController } from '../core/batch-controller.js';
import { ChromeStateStore } from '../storage/state-store.js';
import { IndexedDbResultCache } from '../storage/result-cache.js';
import { OffscreenDownloadManager } from '../storage/offscreen-download-manager.js';
import { reconcileBatchForResume, findSingleFlowTab, sendFlowMessage, captureTrustedGeneration } from './runtime-helpers.js';
import { configureSidePanel } from './side-panel.js';

const state=new ChromeStateStore();
const cache=new IndexedDbResultCache();
const downloader=new OffscreenDownloadManager();
let activeRun=null;
let activeTabId=null;

async function locateFlow(){const found=await findSingleFlowTab();if(found.status!=='CONNECTED'){const message=found.status==='WAITING_FOR_FLOW'?'Open Google Flow first.':found.status==='WAITING_FOR_PROJECT'?'Open a Google Flow project before starting the batch.':'Keep only one Google Flow project tab open for V1.';throw new ExtensionError(found.status,message,{retryable:false,stage:'tab'});}activeTabId=found.tab.id;return found.tab;}
async function sendFlow(type,payload={}){if(!activeTabId)await locateFlow();let response;try{response=await sendFlowMessage(activeTabId,{type,payload});}catch(e){activeTabId=null;await locateFlow();response=await sendFlowMessage(activeTabId,{type,payload});}if(!response?.ok)throw new ExtensionError(response?.error?.code||'FLOW_RPC_ERROR',response?.error?.message||'Flow command failed',{retryable:response?.error?.retryable??true,stage:response?.error?.stage});return response.value;}
const normalizeCaptured=async value=>{if(value instanceof Blob)return value;if(value?.sourceUrl){const r=await fetch(value.sourceUrl,{credentials:'include'});if(!r.ok)throw new ExtensionError('RESULT_FETCH_FAILED',`Generated asset fetch failed: HTTP ${r.status}`,{retryable:true,stage:'capture'});const blob=await r.blob();if(!blob.type.startsWith('image/'))throw new ExtensionError('RESULT_FETCH_FAILED',`Unexpected MIME ${blob.type}`,{retryable:true,stage:'capture'});return blob;}throw new ExtensionError('RESULT_CAPTURE_EMPTY','Flow returned no generated asset',{retryable:true,stage:'capture'});};
const flow={prepare:job=>sendFlow(MSG.FLOW_PREPARE,{job}),uploadReference:file=>sendFlow(MSG.FLOW_UPLOAD_REFERENCE,{file}),setPrompt:text=>sendFlow(MSG.FLOW_SET_PROMPT,{text}),generateAndCapture:async job=>{if(!activeTabId)await locateFlow();const target=await sendFlow(MSG.FLOW_GENERATE_ARM,{job});try{return await captureTrustedGeneration(activeTabId,target,()=>sendFlow(MSG.FLOW_GENERATE_WAIT,{job}));}catch(e){if(e instanceof ExtensionError)throw e;throw new ExtensionError('TRUSTED_CAPTURE_FAILED',`Chrome browser-level generate/capture failed: ${e.message}. Close DevTools for the Flow tab and retry.`,{retryable:false,stage:'capture'});}}};
const controller=new BatchController({flow,state,cache,downloader});
async function startBatch(batch){await locateFlow();if(activeRun)return activeRun;activeRun=controller.run(batch).catch(async e=>{const latest=await state.loadActive();if(latest){latest.status=BATCH_STATUS.PAUSED_ERROR;latest.logs=[...(latest.logs||[]),`Runtime: ${e.message}`].slice(-50);await state.save(latest);}}).finally(()=>{activeRun=null;});return activeRun;}
async function currentState(){const batch=await state.loadActive();const flowState=await findSingleFlowTab();return {batch:batch?summarizeBatch(batch):null,flowStatus:flowState.status};}
async function handle(msg){
 switch(msg.type){
  case MSG.BATCH_IMPORT:{const batch=createBatchFromMarkdown(msg.payload.filename,msg.payload.markdown);await state.save(batch);return currentState();}
  case MSG.BATCH_START:{const batch=await state.loadActive();if(!batch)throw new Error('Import a prompt batch first');if(batch.validation?.errors?.length)throw new Error('Batch has validation errors');void startBatch(batch);return currentState();}
  case MSG.BATCH_PAUSE:{controller.requestPause();return currentState();}
  case MSG.BATCH_RETRY:{const batch=await state.loadActive();if(!batch)throw new Error('No batch');await locateFlow();if(!activeRun)activeRun=controller.retryFailedJob(batch).finally(()=>{activeRun=null;});return currentState();}
  case MSG.BATCH_STOP:{controller.requestStop();const batch=await state.loadActive();if(batch)await controller.stop(batch);return currentState();}
  case MSG.BATCH_GET_STATE:return currentState();
  default:return null;
 }
}
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{if(msg?.target==='offscreen'||!msg?.type?.startsWith('BATCH_'))return;(async()=>{try{return {ok:true,value:await handle(msg)};}catch(e){return {ok:false,error:{message:e.message,code:e.code||'RUNTIME_ERROR'}};}})().then(sendResponse);return true;});
chrome.runtime.onConnect.addListener(port=>{if(port.name==='flow-keepalive')port.onMessage.addListener(()=>{});});
async function resumeIfNeeded(){const batch=await state.loadActive();if(!batch)return;const wasRunning=batch.status===BATCH_STATUS.RUNNING;const reconciled=await reconcileBatchForResume(batch,cache);await state.save(reconciled);if(wasRunning&&reconciled.status===BATCH_STATUS.READY){try{void startBatch(reconciled);}catch{}}}
chrome.runtime.onStartup.addListener(()=>void resumeIfNeeded());
chrome.runtime.onInstalled.addListener(()=>{void configureSidePanel().catch(console.error);void resumeIfNeeded();});

void configureSidePanel().catch(console.error);
