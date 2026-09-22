(() => {
  const urls=new Map();
  const asBlob=(msg)=>{
    if(msg?.blob instanceof Blob)return msg.blob;
    if(msg?.bytes instanceof ArrayBuffer)return new Blob([msg.bytes],{type:msg.mimeType||'image/png'});
    if(ArrayBuffer.isView(msg?.bytes))return new Blob([msg.bytes.buffer],{type:msg.mimeType||'image/png'});
    throw new TypeError('Offscreen did not receive Blob or ArrayBuffer bytes');
  };
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.target!=='offscreen') return;
    if(msg.type==='CREATE_OBJECT_URL'){
      try { const blob=asBlob(msg); const url=URL.createObjectURL(blob); const timer=setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10*60*1000);urls.set(url,timer);sendResponse({ok:true,url}); }
      catch(e){sendResponse({ok:false,error:e.message});}
      return true;
    }
    if(msg.type==='REVOKE_OBJECT_URL'){
      const timer=urls.get(msg.url);if(timer)clearTimeout(timer);URL.revokeObjectURL(msg.url);urls.delete(msg.url);sendResponse({ok:true});return true;
    }
  });
})();
