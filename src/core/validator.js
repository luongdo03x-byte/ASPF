function issue(code,message,jobId=null){return {code,message,jobId};}
export function validateJobs(jobs){
 const errors=[]; const warnings=[]; const seen=new Map();
 if(!Array.isArray(jobs)||!jobs.length) errors.push(issue('UNSUPPORTED_FORMAT','No prompt jobs found'));
 for (const job of jobs||[]) {
   if(!job.id) errors.push(issue('MISSING_ID','Missing job ID'));
   if(seen.has(job.id)) errors.push(issue('DUPLICATE_ID',`Duplicate job ID ${job.id}`,job.id)); else seen.set(job.id,job);
   if(!Number.isInteger(job.index)||!Number.isInteger(job.total)||job.index<1) errors.push(issue('MALFORMED_ORDINAL',`Malformed ordinal for ${job.id}`,job.id));
   if(!job.mainPrompt?.trim()) errors.push(issue('MISSING_PROMPT',`Missing prompt for ${job.id}`,job.id));
   if(!job.aspectRatio?.trim()) errors.push(issue('MISSING_ASPECT_RATIO',`Missing aspect ratio for ${job.id}`,job.id));
   if(job.minWidth) warnings.push(issue('RESOLUTION_UI_UNVERIFIED',`${job.id} requests ${job.minWidth}px; Flow UI may not expose this setting`,job.id));
   if(!/^IMG\d+$/.test(job.imageId||'')) warnings.push(issue('IMAGE_PATTERN',`Unexpected image ID ${job.imageId}`,job.id));
 }
 const byId=new Map((jobs||[]).map(j=>[j.id,j]));
 for(const job of jobs||[]){ if(job.referenceId){ const ref=byId.get(job.referenceId); if(!ref) errors.push(issue('MISSING_REFERENCE',`${job.id} references missing ${job.referenceId}`,job.id)); else if(ref.index>=job.index) errors.push(issue('FORWARD_REFERENCE',`${job.id} references later job ${job.referenceId}`,job.id)); }}
 // DFS catches cycles even if indices are malformed.
 const visiting=new Set(), visited=new Set();
 function visit(id){ if(visiting.has(id)){errors.push(issue('CYCLIC_DEPENDENCY',`Cycle includes ${id}`,id));return;} if(visited.has(id))return; visiting.add(id); const j=byId.get(id); if(j?.referenceId&&byId.has(j.referenceId))visit(j.referenceId); visiting.delete(id); visited.add(id); }
 for(const j of jobs||[]) visit(j.id);
 return {valid:errors.length===0,errors,warnings};
}
