import { MSG } from '../core/constants.js';
import { readPromptFile } from './import-helpers.js';

const $=id=>document.getElementById(id);
let importing=false;

async function send(type,payload){
  const r=await chrome.runtime.sendMessage({type,payload});
  if(!r?.ok)throw new Error(r?.error?.message||'Extension command failed');
  return r.value;
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function render(state){
  const b=state?.batch;
  const flow=state?.flowStatus||'WAITING_FOR_FLOW';
  $('flow-status').textContent=flow==='CONNECTED'?'Flow project connected':flow==='AMBIGUOUS_FLOW_TABS'?'Multiple Flow projects':flow==='WAITING_FOR_PROJECT'?'Open a Flow project':'Open Flow';
  if(!b){
    $('summary').textContent='No batch imported.';
    $('progress-card').classList.add('hidden');
    $('start').disabled=true;
    $('pause').disabled=true;
    $('stop').disabled=true;
    $('retry').classList.add('hidden');
    return;
  }
  $('summary').textContent=`${b.jobCount} prompts · ${b.sceneCount} scenes`;
  $('batch-name').textContent=b.batchName;
  $('batch-status').textContent=b.status;
  $('progress-card').classList.remove('hidden');
  const pct=b.jobCount?Math.round(b.doneCount/b.jobCount*100):0;
  $('progress-bar').style.width=`${pct}%`;
  $('progress-text').textContent=`${b.doneCount} / ${b.jobCount}`;
  const job=b.jobs.find(j=>j.id===b.currentJobId)||b.jobs.find(j=>j.status==='FAILED');
  $('current-job').textContent=job?`Current: ${job.id}${job.referenceId?` · ref ${job.referenceId}`:''} · ${job.status}`:'No active job';
  const v=[...(b.errors||[]).map(x=>`❌ ${x.message}`),...(b.warnings||[]).slice(0,3).map(x=>`⚠ ${x.message}`)];
  $('validation').innerHTML=v.length?`<ul>${v.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:'';
  $('log').textContent=(b.logs?.length?b.logs:['—']).join('\n');
  const connected=flow==='CONNECTED',running=b.status==='RUNNING',pausedError=b.status==='PAUSED_ERROR';
  $('start').disabled=!connected||running||pausedError||b.errors?.length>0||['COMPLETED','STOPPED'].includes(b.status);
  $('pause').disabled=!running;
  $('stop').disabled=!['RUNNING','PAUSED_USER','PAUSED_ERROR','READY'].includes(b.status);
  $('retry').classList.toggle('hidden',!pausedError);
  $('pause').classList.toggle('hidden',pausedError);
}

function showError(message=''){$('error').textContent=message;}
function showImportStatus(message){$('import-status').textContent=message;}

async function refresh(){
  try{render(await send(MSG.BATCH_GET_STATE));showError();}
  catch(e){showError(e.message);}
}

async function importFile(file){
  if(importing)return;
  importing=true;
  try{
    showError();
    showImportStatus(`Reading ${file?.name||'file'}…`);
    const payload=await readPromptFile(file);
    const state=await send(MSG.BATCH_IMPORT,payload);
    render(state);
    showImportStatus(`Imported ${payload.filename}: ${state.batch?.jobCount??0} prompts.`);
  }catch(err){
    showImportStatus('Import failed.');
    showError(err.message);
  }finally{
    importing=false;
    $('prompt-file').value='';
  }
}

$('prompt-file').addEventListener('change',e=>void importFile(e.target.files?.[0]));
const dropZone=$('drop-zone');
for(const type of ['dragenter','dragover'])dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.add('dragging');});
for(const type of ['dragleave','drop'])dropZone.addEventListener(type,e=>{e.preventDefault();dropZone.classList.remove('dragging');});
dropZone.addEventListener('drop',e=>void importFile(e.dataTransfer?.files?.[0]));

$('start').onclick=async()=>{try{render(await send(MSG.BATCH_START));showError();}catch(e){showError(e.message);}};
$('pause').onclick=async()=>{try{render(await send(MSG.BATCH_PAUSE));showError();}catch(e){showError(e.message);}};
$('retry').onclick=async()=>{try{render(await send(MSG.BATCH_RETRY));showError();}catch(e){showError(e.message);}};
$('stop').onclick=async()=>{try{render(await send(MSG.BATCH_STOP));showError();}catch(e){showError(e.message);}};
$('refresh').onclick=refresh;

await refresh();
setInterval(refresh,1000);
