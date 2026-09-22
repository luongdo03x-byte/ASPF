export function findNextRunnableJob(jobs,cachedIds=new Set()){
 return [...jobs].sort((a,b)=>a.index-b.index).find(j=>j.status!=='DONE'&&j.status!=='FAILED'&&(!j.referenceId || (jobs.find(x=>x.id===j.referenceId)?.status==='DONE' && cachedIds.has(j.referenceId))));
}
