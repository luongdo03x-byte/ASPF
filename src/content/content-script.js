(() => {
  const adapter=new globalThis.FlowBatchRuntime.FlowRuntime();
  const serializeError=e=>({code:e?.code||'FLOW_ERROR',message:e?.message||String(e),retryable:e?.retryable??true,stage:e?.stage??null});
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(!msg?.type?.startsWith('FLOW_'))return;
    (async()=>{
      try{
        if(msg.type==='FLOW_PREPARE') await adapter.prepare(msg.payload?.job||{});
        else if(msg.type==='FLOW_UPLOAD_REFERENCE') await adapter.uploadReference(msg.payload.file);
        else if(msg.type==='FLOW_SET_PROMPT') await adapter.setPrompt(msg.payload.text);
        else if(msg.type==='FLOW_GENERATE_ARM') return {ok:true,value:await adapter.armTrustedGenerate()};
        else if(msg.type==='FLOW_GENERATE_WAIT') return {ok:true,value:await adapter.waitForTrustedGenerateAndCapture()};
        else if(msg.type==='FLOW_GENERATE_CAPTURE') return {ok:true,value:await adapter.generateAndCapture(msg.payload?.job||{})};
        else throw Object.assign(new Error('Unknown Flow command'),{retryable:false,code:'UNKNOWN_FLOW_COMMAND'});
        return {ok:true,value:null};
      }catch(e){return {ok:false,error:serializeError(e)};}
    })().then(sendResponse);
    return true;
  });
  const port=chrome.runtime.connect({name:'flow-keepalive'});
  const ping=setInterval(()=>{try{port.postMessage({type:'PING',at:Date.now()});}catch{}},20000);
  port.onDisconnect.addListener(()=>clearInterval(ping));
})();
