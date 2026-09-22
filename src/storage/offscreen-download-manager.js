export class OffscreenDownloadManager {
  constructor(chromeApi=chrome){this.chrome=chromeApi;}
  async ensureOffscreen(){
    const has=await this.chrome.offscreen.hasDocument();
    if(!has) await this.chrome.offscreen.createDocument({url:'offscreen/offscreen.html',reasons:['BLOBS'],justification:'Create temporary object URLs for generated image downloads.'});
  }
  async save(blob,path){
    if(!(blob instanceof Blob)){
      if(blob?.buffer instanceof ArrayBuffer) blob=new Blob([blob.buffer],{type:blob.type||'image/png'});
      else if(blob instanceof ArrayBuffer) blob=new Blob([blob],{type:'image/png'});
      else throw new TypeError(`Download manager expected Blob, received ${Object.prototype.toString.call(blob)}`);
    }
    await this.ensureOffscreen();
    const bytes=await blob.arrayBuffer();
    const response=await this.chrome.runtime.sendMessage({target:'offscreen',type:'CREATE_OBJECT_URL',bytes,mimeType:blob.type||'image/png'});
    if(!response?.ok) throw new Error(response?.error||'Could not create download URL');
    const id=await this.chrome.downloads.download({url:response.url,filename:path,saveAs:false,conflictAction:'uniquify'});
    const url=response.url;
    const listener=(delta)=>{if(delta.id!==id||!delta.state?.current)return;if(['complete','interrupted'].includes(delta.state.current)){this.chrome.downloads.onChanged.removeListener(listener);void this.chrome.runtime.sendMessage({target:'offscreen',type:'REVOKE_OBJECT_URL',url});}};
    this.chrome.downloads.onChanged.addListener(listener);
    return id;
  }
}
