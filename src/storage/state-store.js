const KEY='flowBatch.active';
const clone=x=>structuredClone(x);
export class MemoryStateStore { constructor(){this.value=null;} async save(batch){this.value=clone(batch);} async loadActive(){return this.value?clone(this.value):null;} async clear(){this.value=null;} }
export class ChromeStateStore { async save(batch){await chrome.storage.local.set({[KEY]:batch});} async loadActive(){const x=await chrome.storage.local.get(KEY); return x[KEY]??null;} async clear(){await chrome.storage.local.remove(KEY);} }
