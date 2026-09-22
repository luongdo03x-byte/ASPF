import { MSG } from '../core/constants.js';
const $=id=>document.getElementById(id);
let latest=null;
async function send(type,payload){const r=await chrome.runtime.sendMessage({type,payload});if(!r?.ok)throw new Error(r?.error?.message||'Extension command failed');return r.value;}
function render(state){latest=state;const b=state?.batch;const flow=state?.flowStatus||'WAITING_FOR_FLOW';$('flow-status').textContent=flow==='CONNECTED'?'Flow connected':flow==='AMBIGUOUS_FLOW_TABS'?'Multiple Flow tabs':'Open Flow';
 if(!b){$('summary').textContent='No batch imported.';$('progress-card').classList.add('hidden');$('start').disabled=true;return;}
 $('summary').textContent=`${b.jobCount} prompts · ${b.sceneCount} scenes`;$('batch-name').textContent=b.batchName;$('batch-status').textContent=b.status;$('progress-card').classList.remove('hidden');const pct=b.jobCount?Math.round(b.doneCount/b.jobCount*100):0;$('progress-bar').style.width=`${pct}%`;$('progress-text').textContent=`${b.doneCount} / ${b.jobCount}`;const job=b.jobs.find(j=>j.id===b.currentJobId)||b.jobs.find(j=>j.status==='FAILED');$('current-job').textContent=job?`Current: ${job.id}${job.referenceId?` · ref ${job.referenceId}`:''} · ${job.status}`:'No active job';
 const v=[...(b.errors||[]).map(x=>`❌ ${x.message}`),...(b.warnings||[]).slice(0,3).map(x=>`⚠ ${x.message}`)];$('validation').innerHTML=v.length?`<ul>${v.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:'';$('log').textContent=(b.logs?.length?b.logs:['—']).join('\n');const connected=flow==='CONNECTED',running=b.status==='RUNNING',pausedError=b.status==='PAUSED_ERROR';$('start').disabled=!connected||running||b.status==='PAUSED_ERROR'||b.errors?.length>0||['COMPLETED','STOPPED'].includes(b.status);$('pause').disabled=!running;$('stop').disabled=!['RUNNING','PAUSED_USER','PAUSED_ERROR','READY'].includes(b.status);$('retry').classList.toggle('hidden',!pausedError);$('pause').classList.toggle('hidden',pausedError);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function refresh(){try{render(await send(MSG.BATCH_GET_STATE));$('error').textContent='';}catch(e){$('error').textContent=e.message;}}
$('prompt-file').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{render(await send(MSG.BATCH_IMPORT,{filename:f.name,markdown:await f.text()}));$('error').textContent='';}catch(err){$('error').textContent=err.message;}});
$('start').onclick=async()=>{try{render(await send(MSG.BATCH_START));}catch(e){$('error').textContent=e.message;}};
$('pause').onclick=async()=>{try{render(await send(MSG.BATCH_PAUSE));}catch(e){$('error').textContent=e.message;}};
$('retry').onclick=async()=>{try{render(await send(MSG.BATCH_RETRY));}catch(e){$('error').textContent=e.message;}};
$('stop').onclick=async()=>{try{render(await send(MSG.BATCH_STOP));}catch(e){$('error').textContent=e.message;}};
$('refresh').onclick=refresh;
await refresh();setInterval(refresh,1000);
