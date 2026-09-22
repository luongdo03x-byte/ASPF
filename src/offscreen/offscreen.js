(() => {
  const urls=new Map();
  const base64ToBytes=(base64)=>{
    if(typeof base64!=='string'||!base64.length)throw new TypeError('Offscreen did not receive base64 image data');
    const binary=atob(base64);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes;
  };
  const asBlob=(msg)=>{
    if(typeof msg?.base64==='string')return new Blob([base64ToBytes(msg.base64)],{type:msg.mimeType||'image/png'});
    if(msg?.blob instanceof Blob)return msg.blob;
    if(msg?.bytes instanceof ArrayBuffer)return new Blob([msg.bytes],{type:msg.mimeType||'image/png'});
    if(ArrayBuffer.isView(msg?.bytes))return new Blob([msg.bytes.buffer],{type:msg.mimeType||'image/png'});
    throw new TypeError('Offscreen did not receive image bytes');
  };
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.target!=='offscreen') return;
    if(msg.type==='CREATE_OBJECT_URL'){
      try {
        const blob=asBlob(msg);
        const url=URL.createObjectURL(blob);
        const timer=setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10*60*1000);
        urls.set(url,timer);
        sendResponse({ok:true,url});
      } catch(e){
        sendResponse({ok:false,error:e.message});
      }
      return true;
    }
    if(msg.type==='REVOKE_OBJECT_URL'){
      const timer=urls.get(msg.url);
      if(timer)clearTimeout(timer);
      URL.revokeObjectURL(msg.url);
      urls.delete(msg.url);
      sendResponse({ok:true});
      return true;
    }
  });
})();
