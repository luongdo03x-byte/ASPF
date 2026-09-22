export function extensionForMime(mime=''){return ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[mime.toLowerCase()]||'img';}
export function sanitizePathPart(s){return String(s).replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim()||'batch';}
export function buildDownloadPath(batchName,jobId,mime){return `FlowBatch/${sanitizePathPart(batchName)}/${sanitizePathPart(jobId)}.${extensionForMime(mime)}`;}
export class ChromeDownloadManager { async save(blob,path){const url=URL.createObjectURL(blob);try{return await chrome.downloads.download({url,filename:path,saveAs:false,conflictAction:'uniquify'});}finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}} }
