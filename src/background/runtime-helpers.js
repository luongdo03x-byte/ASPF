import { BATCH_STATUS, JOB_STATUS } from '../core/constants.js';

const UNCERTAIN=new Set([JOB_STATUS.PREPARING_FLOW,JOB_STATUS.UPLOADING_REFERENCE,JOB_STATUS.SETTING_PROMPT,JOB_STATUS.GENERATING,JOB_STATUS.WAITING_RESULT,JOB_STATUS.CAPTURING_RESULT,JOB_STATUS.CACHING_RESULT,JOB_STATUS.DOWNLOADING,JOB_STATUS.RETRY_WAIT]);
export async function reconcileBatchForResume(batch,cache){
 if(!batch || [BATCH_STATUS.COMPLETED,BATCH_STATUS.STOPPED].includes(batch.status)) return batch;
 for(const job of batch.jobs){if(UNCERTAIN.has(job.status))job.status=JOB_STATUS.PENDING;}
 for(const job of batch.jobs){if(job.status==='DONE')continue;if(job.referenceId){const ref=batch.jobs.find(x=>x.id===job.referenceId);if(ref?.status==='DONE' && !(await cache.has(batch.id,job.referenceId))){job.status=JOB_STATUS.FAILED;job.lastError=`Missing cached dependency ${job.referenceId}`;batch.currentJobId=job.id;batch.status=BATCH_STATUS.PAUSED_ERROR;return batch;}}}
 if(batch.status===BATCH_STATUS.RUNNING)batch.status=BATCH_STATUS.READY;
 return batch;
}
export async function findSingleFlowTab(chromeApi=chrome){const tabs=await chromeApi.tabs.query({url:['https://flow.google.com/*','https://flow.google/*']});if(tabs.length===0)return {status:'WAITING_FOR_FLOW',tab:null};const projects=tabs.filter(tab=>{try{const u=new URL(tab.url||'');return /^\/project\//.test(u.pathname);}catch{return false;}});if(projects.length===0)return {status:'WAITING_FOR_PROJECT',tab:null};if(projects.length>1)return {status:'AMBIGUOUS_FLOW_TABS',tab:null};return {status:'CONNECTED',tab:projects[0]};}

export function isMissingReceiverError(error){
 const message=String(error?.message||error||'');
 return /receiving end does not exist|could not establish connection/i.test(message);
}

export async function sendFlowMessage(tabId,message,chromeApi=chrome){
 try{
  return await chromeApi.tabs.sendMessage(tabId,message);
 }catch(error){
  if(!isMissingReceiverError(error))throw error;
  await chromeApi.scripting.executeScript({
   target:{tabId},
   files:['flow/content-runtime.js','content/content-script.js']
  });
  return chromeApi.tabs.sendMessage(tabId,message);
 }
}


async function dispatchClickCommands(debuggee,target,chromeApi){
 await chromeApi.debugger.sendCommand(debuggee,'Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y,button:'none',buttons:0,pointerType:'mouse'});
 await chromeApi.debugger.sendCommand(debuggee,'Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',buttons:1,clickCount:1,pointerType:'mouse'});
 await chromeApi.debugger.sendCommand(debuggee,'Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',buttons:0,clickCount:1,pointerType:'mouse'});
}

export async function dispatchTrustedClick(tabId,target,chromeApi=chrome){
 if(!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error('Invalid trusted click target');
 const debuggee={tabId};
 let attached=false;
 try{
  await chromeApi.debugger.attach(debuggee,'1.3');
  attached=true;
  await dispatchClickCommands(debuggee,target,chromeApi);
 } finally {
  if(attached){try{await chromeApi.debugger.detach(debuggee);}catch{}}
 }
}

function decodeBody(body,base64Encoded){
 if(!base64Encoded)return new TextEncoder().encode(body);
 const binary=atob(body);
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
function normalizedUrl(value){try{const u=new URL(value);u.hash='';return u.href;}catch{return String(value||'');}}
function urlsMatch(a,b){return normalizedUrl(a)===normalizedUrl(b);}
function sniffImageMime(bytes,fallback=''){
 const b=bytes||new Uint8Array();
 if(b.length>=8&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a)return 'image/png';
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b.length>=12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 if(b.length>=6){const sig=String.fromCharCode(...b.slice(0,6));if(sig==='GIF87a'||sig==='GIF89a')return 'image/gif';}
 if(b.length>=12&&String.fromCharCode(...b.slice(4,8))==='ftyp'){
  const brand=String.fromCharCode(...b.slice(8,12));
  if(/avif|avis/.test(brand))return 'image/avif';
 }
 return /^image\//i.test(fallback)&&!/svg/i.test(fallback)?fallback:'';
}
function likelyGeneratedAsset(url,mimeType=''){
 if(/^image\//i.test(mimeType)&&!/svg/i.test(mimeType))return true;
 return /googleusercontent\.com|gstatic\.com|generated|\/image\b|image[_-]|media/i.test(String(url||''));
}

export async function captureTrustedGeneration(tabId,target,waitForDescriptor,chromeApi=chrome,options={}){
 if(!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error('Invalid trusted click target');
 const timeoutMs=options.timeoutMs??180000;
 const minBytes=options.minBytes??50000;
 const debuggee={tabId};
 const responses=new Map();
 const bodyTried=new Set();
 let attached=false;
 let clicked=false;
 let descriptorValue=null;
 let descriptorError=null;
 let descriptorSettled=false;
 const onEvent=(source,method,params)=>{
  if(source?.tabId!==tabId||!clicked)return;
  if(method==='Network.responseReceived'){
   const mimeType=params?.response?.mimeType||'';
   const url=params?.response?.url||'';
   if(!url||!likelyGeneratedAsset(url,mimeType))return;
   responses.set(params.requestId,{requestId:params.requestId,url,mimeType,headers:params?.response?.headers||{},encodedDataLength:0,finished:false});
  }else if(method==='Network.loadingFinished'){
   const rec=responses.get(params?.requestId);
   if(rec){rec.finished=true;rec.encodedDataLength=Number(params?.encodedDataLength||0);}
  }
 };
 const readResponseBody=async rec=>{
  try{
   const body=await chromeApi.debugger.sendCommand(debuggee,'Network.getResponseBody',{requestId:rec.requestId});
   const bytes=decodeBody(body.body,body.base64Encoded);
   if(!bytes.length)return null;
   const mime=sniffImageMime(bytes,rec.mimeType);
   if(!mime)return null;
   return new Blob([bytes],{type:mime});
  }catch{return null;}
 };
 const captureRect=async rect=>{
  if(!(rect&&Number.isFinite(rect.x)&&Number.isFinite(rect.y)&&rect.width>0&&rect.height>0))return null;
  const shot=await chromeApi.debugger.sendCommand(debuggee,'Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:1}});
  return shot?.data?new Blob([decodeBody(shot.data,true)],{type:'image/png'}):null;
 };
 try{
  await chromeApi.debugger.attach(debuggee,'1.3');
  attached=true;
  chromeApi.debugger.onEvent?.addListener?.(onEvent);
  await chromeApi.debugger.sendCommand(debuggee,'Network.enable',{});
  clicked=true;
  await dispatchClickCommands(debuggee,target,chromeApi);

  Promise.resolve()
   .then(()=>waitForDescriptor())
   .then(value=>{descriptorValue=value;descriptorSettled=true;})
   .catch(error=>{descriptorError=error;descriptorSettled=true;});

  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
   // Do not capture network bytes before the content runtime confirms that
   // Flow's visual result has finished rendering and remained stable.
   if(!descriptorSettled){
    await new Promise(r=>setTimeout(r,80));
    continue;
   }

   if(descriptorError){
    descriptorError.retryable=false;
    descriptorError.stage=descriptorError.stage||'capture';
    throw descriptorError;
   }

   if(descriptorValue instanceof Blob)return descriptorValue;

   const sourceUrl=descriptorValue?.sourceUrl||'';
   if(sourceUrl){
    const exact=[...responses.values()].find(r=>urlsMatch(r.url,sourceUrl));
    if(exact){
     const blob=await readResponseBody(exact);
     if(blob)return blob;
    }
   }

   // If the DOM readiness gate has a settled card rectangle but the final
   // asset URL cannot be matched exactly, capture that final rendered card
   // before considering any generic network response. This prevents an early
   // preview/placeholder response from being mistaken for the completed image.
   if(descriptorValue?.rect){
    const shot=await captureRect(descriptorValue.rect);
    if(shot)return shot;
   }

   const finished=[...responses.values()]
    .filter(r=>r.finished&&!bodyTried.has(r.requestId))
    .sort((a,b)=>b.encodedDataLength-a.encodedDataLength);
   for(const rec of finished){
    bodyTried.add(rec.requestId);
    const blob=await readResponseBody(rec);
    if(blob&&blob.size>=minBytes)return blob;
   }

   await new Promise(r=>setTimeout(r,80));
  }

  if(descriptorValue?.rect){
   const shot=await captureRect(descriptorValue.rect);
   if(shot)return shot;
  }
  if(descriptorError){descriptorError.retryable=false;descriptorError.stage=descriptorError.stage||'capture';throw descriptorError;}
  const captureError=new Error('Generated image was not captured from Flow network or DOM');
  captureError.retryable=false;captureError.stage='capture';throw captureError;
 } catch(error) {
  if(clicked){error.retryable=false;error.stage=error.stage||'capture';error.submitted=true;}
  throw error;
 } finally {
  chromeApi.debugger.onEvent?.removeListener?.(onEvent);
  if(attached){try{await chromeApi.debugger.sendCommand(debuggee,'Network.disable',{});}catch{}try{await chromeApi.debugger.detach(debuggee);}catch{}}
 }
}
