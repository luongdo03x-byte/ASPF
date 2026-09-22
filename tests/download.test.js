import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionForMime, buildDownloadPath } from '../src/storage/download-manager.js';
import { OffscreenDownloadManager } from '../src/storage/offscreen-download-manager.js';

test('uses real mime extension and sanitized batch path', () => {
  assert.equal(extensionForMime('image/jpeg'),'jpg');
  assert.equal(extensionForMime('image/webp'),'webp');
  assert.equal(buildDownloadPath('a/b','S01_IMG01','image/png'),'FlowBatch/a-b/S01_IMG01.png');
});


test('sends generated image bytes to offscreen as base64 instead of ArrayBuffer', async()=>{
  const messages=[];
  const listeners=[];
  const chromeApi={
    offscreen:{
      hasDocument:async()=>true,
      createDocument:async()=>{}
    },
    runtime:{
      sendMessage:async msg=>{
        messages.push(msg);
        if(msg.type==='CREATE_OBJECT_URL')return {ok:true,url:'blob:test'};
        return {ok:true};
      }
    },
    downloads:{
      download:async()=>7,
      onChanged:{
        addListener:fn=>listeners.push(fn),
        removeListener:()=>{}
      }
    }
  };
  const manager=new OffscreenDownloadManager(chromeApi);
  await manager.save(new Blob([new Uint8Array([0,1,2,250,255])],{type:'image/png'}),'FlowBatch/demo/test.png');
  const create=messages.find(m=>m.type==='CREATE_OBJECT_URL');
  assert.equal(typeof create.base64,'string');
  assert.equal(create.mimeType,'image/png');
  assert.equal('bytes' in create,false);
  assert.equal(Buffer.from(create.base64,'base64').toString('hex'),'000102faff');
});
