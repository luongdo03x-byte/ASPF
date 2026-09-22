import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { findSingleFlowTab, dispatchTrustedClick } from '../src/background/runtime-helpers.js';

test('detects a Google Flow project tab on flow.google.com', async () => {
  const chromeApi = {
    tabs: {
      query: async ({ url }) => {
        const patterns = Array.isArray(url) ? url : [url];
        return patterns.includes('https://flow.google.com/*')
          ? [{ id: 77, url: 'https://flow.google.com/project/demo' }]
          : [];
      }
    }
  };

  const result = await findSingleFlowTab(chromeApi);
  assert.equal(result.status, 'CONNECTED');
  assert.equal(result.tab.id, 77);
});

test('manifest injects the content script only on Flow project pages', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://flow.google.com/*'));
  assert.ok(manifest.content_scripts[0].matches.includes('https://flow.google.com/project/*'));
  assert.ok(!manifest.content_scripts[0].matches.includes('https://flow.google.com/*'));
});

test('injects Flow content scripts and retries when a tab has no receiver', async () => {
  const sent = [];
  const injected = [];
  const chromeApi = {
    tabs: {
      sendMessage: async (tabId, message) => {
        sent.push({ tabId, message });
        if (sent.length === 1) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { ok: true, value: 'ready' };
      }
    },
    scripting: {
      executeScript: async details => { injected.push(details); }
    }
  };
  const { sendFlowMessage } = await import('../src/background/runtime-helpers.js');
  const result = await sendFlowMessage(77, { type: 'FLOW_PREPARE' }, chromeApi);
  assert.deepEqual(result, { ok: true, value: 'ready' });
  assert.equal(sent.length, 2);
  assert.deepEqual(injected, [{
    target: { tabId: 77 },
    files: ['flow/content-runtime.js', 'content/content-script.js']
  }]);
});

test('does not inject scripts for unrelated tab messaging errors', async () => {
  let injected = false;
  const chromeApi = {
    tabs: { sendMessage: async () => { throw new Error('The tab was closed.'); } },
    scripting: { executeScript: async () => { injected = true; } }
  };
  const { sendFlowMessage } = await import('../src/background/runtime-helpers.js');
  await assert.rejects(() => sendFlowMessage(77, { type: 'FLOW_PREPARE' }, chromeApi), /tab was closed/i);
  assert.equal(injected, false);
});

test('manifest grants scripting permission for recovery injection', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('scripting'));
});

test('does not treat Flow homepage as a runnable project tab', async () => {
  const chromeApi = {
    tabs: {
      query: async () => [{ id: 88, url: 'https://flow.google.com/' }]
    }
  };
  const result = await findSingleFlowTab(chromeApi);
  assert.equal(result.status, 'WAITING_FOR_PROJECT');
  assert.equal(result.tab, null);
});


test('dispatches a browser-level trusted click and detaches debugger', async () => {
  const calls=[];
  const chromeApi={
    debugger:{
      attach: async (target,version)=>calls.push(['attach',target,version]),
      sendCommand: async (target,method,params)=>calls.push(['command',target,method,params]),
      detach: async target=>calls.push(['detach',target])
    }
  };
  await dispatchTrustedClick(77,{x:420,y:690},chromeApi);
  assert.equal(calls[0][0],'attach');
  assert.equal(calls[1][2],'Input.dispatchMouseEvent');
  assert.equal(calls[1][3].type,'mouseMoved');
  assert.equal(calls[2][3].type,'mousePressed');
  assert.equal(calls[3][3].type,'mouseReleased');
  assert.equal(calls.at(-1)[0],'detach');
});

test('manifest grants debugger permission for browser-level click fallback', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('debugger'));
});

test('captures the generated image body from DevTools Network for the exact Flow asset URL', async () => {
  const calls=[];
  let eventListener=null;
  const imageUrl='https://lh3.googleusercontent.com/generated/test.png';
  const chromeApi={
    debugger:{
      onEvent:{
        addListener(fn){ eventListener=fn; },
        removeListener(fn){ if(eventListener===fn) eventListener=null; }
      },
      attach: async (target,version)=>calls.push(['attach',target,version]),
      sendCommand: async (target,method,params)=>{
        calls.push(['command',target,method,params]);
        if(method==='Input.dispatchMouseEvent' && params.type==='mouseReleased'){
          queueMicrotask(()=>eventListener?.(target,'Network.responseReceived',{
            requestId:'req-1',
            response:{url:imageUrl,mimeType:'image/png'}
          }));
        }
        if(method==='Network.getResponseBody'){
          return {body:btoa('PNG_BYTES'),base64Encoded:true};
        }
        return {};
      },
      detach: async target=>calls.push(['detach',target])
    }
  };
  const { captureTrustedGeneration } = await import('../src/background/runtime-helpers.js');
  const blob=await captureTrustedGeneration(77,{x:420,y:690},async()=>({sourceUrl:imageUrl,rect:{x:200,y:150,width:600,height:340}}),chromeApi);
  assert.equal(blob.type,'image/png');
  assert.equal(await blob.text(),'PNG_BYTES');
  assert.ok(calls.some(x=>x[2]==='Network.enable'));
  assert.ok(calls.some(x=>x[2]==='Network.getResponseBody'));
  assert.equal(calls.at(-1)[0],'detach');
});


test('does not capture Network bytes until the DOM readiness gate resolves', async () => {
  let eventListener=null;
  let bodyReads=0;
  let releaseDescriptor;
  const imageUrl='https://lh3.googleusercontent.com/generated/final.webp';
  const gate=new Promise(resolve=>{releaseDescriptor=resolve;});
  const chromeApi={
    debugger:{
      onEvent:{
        addListener(fn){eventListener=fn;},
        removeListener(fn){if(eventListener===fn)eventListener=null;}
      },
      attach:async()=>{},
      sendCommand:async(target,method,params)=>{
        if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'){
          queueMicrotask(()=>{
            eventListener?.(target,'Network.responseReceived',{requestId:'generated-1',response:{url:imageUrl,mimeType:'image/webp'}});
            eventListener?.(target,'Network.loadingFinished',{requestId:'generated-1',encodedDataLength:120000});
          });
        }
        if(method==='Network.getResponseBody'){
          bodyReads++;
          return {body:btoa('X'.repeat(60000)),base64Encoded:true};
        }
        return {};
      },
      detach:async()=>{}
    }
  };
  const {captureTrustedGeneration}=await import('../src/background/runtime-helpers.js');
  const capture=captureTrustedGeneration(77,{x:420,y:690},()=>gate,chromeApi,{timeoutMs:1000,minBytes:50000});
  await new Promise(r=>setTimeout(r,40));
  assert.equal(bodyReads,0,'network body must not be consumed while the visual is still rendering');
  releaseDescriptor({sourceUrl:imageUrl,rect:{x:200,y:150,width:600,height:340}});
  const blob=await capture;
  assert.equal(blob.type,'image/webp');
  assert.equal(blob.size,60000);
  assert.equal(bodyReads,1);
});

test('network capture ignores tiny UI images and uses the large generated response', async () => {
  let eventListener=null;
  const chromeApi={
    debugger:{
      onEvent:{addListener(fn){eventListener=fn;},removeListener(){eventListener=null;}},
      attach:async()=>{},
      sendCommand:async(target,method,params)=>{
        if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'){
          queueMicrotask(()=>{
            eventListener?.(target,'Network.responseReceived',{requestId:'icon',response:{url:'https://flow.google.com/icon.png',mimeType:'image/png'}});
            eventListener?.(target,'Network.loadingFinished',{requestId:'icon',encodedDataLength:2048});
            eventListener?.(target,'Network.responseReceived',{requestId:'generated',response:{url:'https://lh3.googleusercontent.com/generated/image.png',mimeType:'image/png'}});
            eventListener?.(target,'Network.loadingFinished',{requestId:'generated',encodedDataLength:140000});
          });
        }
        if(method==='Network.getResponseBody'){
          const body=params.requestId==='icon'?'i'.repeat(2000):'G'.repeat(70000);
          return {body:btoa(body),base64Encoded:true};
        }
        return {};
      },
      detach:async()=>{}
    }
  };
  const {captureTrustedGeneration}=await import('../src/background/runtime-helpers.js');
  const finalUrl='https://lh3.googleusercontent.com/generated/image.png';
  const blob=await captureTrustedGeneration(
    77,
    {x:420,y:690},
    async()=>({sourceUrl:finalUrl,rect:{x:200,y:150,width:600,height:340}}),
    chromeApi,
    {timeoutMs:500,minBytes:50000}
  );
  assert.equal(blob.size,70000);
});


test('uses the settled DOM card screenshot before an unmatched preview Network response', async () => {
  let eventListener=null;
  let networkBodyReads=0;
  let screenshots=0;
  const chromeApi={
    debugger:{
      onEvent:{addListener(fn){eventListener=fn;},removeListener(){eventListener=null;}},
      attach:async()=>{},
      sendCommand:async(target,method,params)=>{
        if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'){
          queueMicrotask(()=>{
            eventListener?.(target,'Network.responseReceived',{
              requestId:'preview',
              response:{url:'https://lh3.googleusercontent.com/generated/preview.png',mimeType:'image/png'}
            });
            eventListener?.(target,'Network.loadingFinished',{requestId:'preview',encodedDataLength:90000});
          });
        }
        if(method==='Network.getResponseBody'){
          networkBodyReads++;
          return {body:btoa('P'.repeat(60000)),base64Encoded:true};
        }
        if(method==='Page.captureScreenshot'){
          screenshots++;
          return {data:btoa('FINAL_SCREENSHOT')};
        }
        return {};
      },
      detach:async()=>{}
    }
  };
  const {captureTrustedGeneration}=await import('../src/background/runtime-helpers.js');
  const blob=await captureTrustedGeneration(
    77,
    {x:420,y:690},
    async()=>({sourceUrl:'',rect:{x:200,y:150,width:600,height:340}}),
    chromeApi,
    {timeoutMs:500,minBytes:50000}
  );
  assert.equal(blob.type,'image/png');
  assert.equal(await blob.text(),'FINAL_SCREENSHOT');
  assert.equal(screenshots,1);
  assert.equal(networkBodyReads,0,'preview network response must not beat the settled DOM card');
});

test('marks post-submit capture failures as non-retryable to prevent duplicate generations', async () => {
  const chromeApi={
    debugger:{
      onEvent:{addListener(){},removeListener(){}},
      attach:async()=>{},
      sendCommand:async()=>({}),
      detach:async()=>{}
    }
  };
  const descriptorError=Object.assign(new Error('result detector timed out'),{retryable:true,stage:'result'});
  const {captureTrustedGeneration}=await import('../src/background/runtime-helpers.js');
  await assert.rejects(
    ()=>captureTrustedGeneration(77,{x:10,y:20},async()=>{throw descriptorError;},chromeApi,{timeoutMs:20,minBytes:50000}),
    err=>err.message==='result detector timed out'&&err.retryable===false
  );
});


test('captures generated image bytes even when Flow reports application/octet-stream and zero encoded length', async () => {
  let eventListener=null;
  const png=String.fromCharCode(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)+'X'.repeat(60000);
  const chromeApi={debugger:{
    onEvent:{addListener(fn){eventListener=fn;},removeListener(){eventListener=null;}},
    attach:async()=>{},detach:async()=>{},
    sendCommand:async(target,method,params)=>{
      if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'){
        queueMicrotask(()=>{
          eventListener?.(target,'Network.responseReceived',{requestId:'opaque-image',response:{url:'https://lh3.googleusercontent.com/generated/opaque',mimeType:'application/octet-stream',headers:{}}});
          eventListener?.(target,'Network.loadingFinished',{requestId:'opaque-image',encodedDataLength:0});
        });
      }
      if(method==='Network.getResponseBody') return {body:btoa(png),base64Encoded:true};
      return {};
    }
  }};
  const {captureTrustedGeneration}=await import('../src/background/runtime-helpers.js');
  const finalUrl='https://lh3.googleusercontent.com/generated/opaque';
  const blob=await captureTrustedGeneration(
    77,
    {x:40,y:50},
    async()=>({sourceUrl:finalUrl,rect:{x:200,y:150,width:600,height:340}}),
    chromeApi,
    {timeoutMs:500,minBytes:50000}
  );
  assert.equal(blob.type,'image/png');
  assert.ok(blob.size>50000);
});

test('does not use a preview Network response when the render gate fails', async () => {
  let eventListener=null;
  let bodyReads=0;
  const chromeApi={debugger:{
    onEvent:{addListener(fn){eventListener=fn;},removeListener(){eventListener=null;}},
    attach:async()=>{},detach:async()=>{},
    sendCommand:async(target,method,params)=>{
      if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'){
        queueMicrotask(()=>{
          eventListener?.(target,'Network.responseReceived',{
            requestId:'preview',
            response:{url:'https://lh3.googleusercontent.com/generated/preview.png',mimeType:'image/png'}
          });
          eventListener?.(target,'Network.loadingFinished',{requestId:'preview',encodedDataLength:120000});
        });
      }
      if(method==='Network.getResponseBody'){
        bodyReads++;
        return {body:btoa('P'.repeat(70000)),base64Encoded:true};
      }
      return {};
    }
  }};
  const renderError=Object.assign(new Error('Generated image did not become fully rendered and stable before timeout'),{
    retryable:true,
    stage:'result'
  });
  const {captureTrustedGeneration}=await import('../src/background/runtime-helpers.js');
  await assert.rejects(
    ()=>captureTrustedGeneration(
      77,
      {x:40,y:50},
      async()=>{throw renderError;},
      chromeApi,
      {timeoutMs:200,minBytes:50000}
    ),
    err=>err.message.includes('fully rendered')&&err.retryable===false
  );
  assert.equal(bodyReads,0,'preview bytes must not be consumed after the render gate fails');
});

test('any error after trusted click is marked non-retryable', async () => {
  const chromeApi={debugger:{
    onEvent:{addListener(){},removeListener(){}},
    attach:async()=>{},detach:async()=>{},
    sendCommand:async(_target,method,params)=>{
      if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased') throw new Error('click dispatch transport failed');
      return {};
    }
  }};
  const {captureTrustedGeneration}=await import('../src/background/runtime-helpers.js');
  await assert.rejects(
    ()=>captureTrustedGeneration(77,{x:40,y:50},()=>new Promise(()=>{}),chromeApi,{timeoutMs:20}),
    err=>err.retryable===false
  );
});
