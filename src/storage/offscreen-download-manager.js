function arrayBufferToBase64(buffer){
  const bytes=new Uint8Array(buffer);
  const chunkSize=0x8000;
  let binary='';
  for(let i=0;i<bytes.length;i+=chunkSize){
    const chunk=bytes.subarray(i,Math.min(i+chunkSize,bytes.length));
    binary+=String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

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
    const base64=arrayBufferToBase64(bytes);
    const response=await this.chrome.runtime.sendMessage({target:'offscreen',type:'CREATE_OBJECT_URL',base64,mimeType:blob.type||'image/png'});
    if(!response?.ok) throw new Error(response?.error||'Could not create download URL');
    const id=await this.chrome.downloads.download({url:response.url,filename:path,saveAs:false,conflictAction:'uniquify'});
    const url=response.url;
    const listener=(delta)=>{if(delta.id!==id||!delta.state?.current)return;if(['complete','interrupted'].includes(delta.state.current)){this.chrome.downloads.onChanged.removeListener(listener);void this.chrome.runtime.sendMessage({target:'offscreen',type:'REVOKE_OBJECT_URL',url});}};
    this.chrome.downloads.onChanged.addListener(listener);
    return id;
  }
}
