import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowAdapter, snapshotImageSources } from '../src/flow/flow-adapter.js';

function el({text='',aria='',title='',role='',tag='BUTTON',src='',type='',contenteditable=false,disabled=false}={}){
 return {innerText:text,textContent:text,tagName:tag,src,type,disabled,files:null,value:'',dataset:{},
  getAttribute:(k)=>({ 'aria-label':aria, title, role, contenteditable:contenteditable?'true':null }[k]??null),
  click(){this.clicked=true;}, dispatchEvent(){}, setAttribute(){}, focus(){},
 };
}
function doc(elements){return {querySelectorAll(sel){
 if(sel==='button') return elements.filter(x=>x.tagName==='BUTTON');
 if(sel==='img') return elements.filter(x=>x.tagName==='IMG');
 if(sel==='input[type="file"]') return elements.filter(x=>x.tagName==='INPUT'&&x.type==='file');
 if(sel==='textarea') return elements.filter(x=>x.tagName==='TEXTAREA');
 if(sel==='[contenteditable="true"]') return elements.filter(x=>x.getAttribute('contenteditable')==='true');
 return [];
 }};}

test('snapshot returns existing result image sources',()=>{const d=doc([el({tag:'IMG',src:'a'}),el({tag:'IMG',src:'b'})]);assert.deepEqual([...snapshotImageSources(d)],['a','b']);});

test('setPrompt resolves a semantic prompt editor and writes text',async()=>{const input=el({tag:'TEXTAREA',aria:'Prompt'});const d=doc([input]);const a=new FlowAdapter({document:d,fetch:async()=>{}});await a.setPrompt('hello');assert.equal(input.value,'hello');});

test('clickGenerate resolves Generate button by visible text inside a project composer',async()=>{const input=el({tag:'TEXTAREA',aria:'What do you want to create?'});const add=el({aria:'Add'});const button=el({text:'Generate'});const container={parentElement:null,querySelectorAll:(sel)=>sel==='button'?[add,button]:[]};input.parentElement=container;const a=new FlowAdapter({document:doc([input,add,button]),fetch:async()=>{},location:{hostname:'flow.google.com',pathname:'/project/demo'}});await a.clickGenerate();assert.equal(button.clicked,true);});


test('prepare only requires prompt editor before prompt enables the send button',async()=>{
 const input=el({tag:'TEXTAREA',aria:'What do you want to create?'});
 const send=el({aria:'Send',disabled:true});
 const a=new FlowAdapter({document:doc([input,send]),fetch:async()=>{}});
 await assert.doesNotReject(()=>a.prepare({aspectRatio:'16:9'}));
});

test('clickGenerate recognizes Flow composer Send button',async()=>{
 const input=el({tag:'TEXTAREA',aria:'What do you want to create?'});
 const add=el({aria:'Add'});
 const send=el({aria:'Send'});
 const container={parentElement:null,querySelectorAll:(sel)=>sel==='button'?[add,send]:[]};
 input.parentElement=container;
 const a=new FlowAdapter({document:doc([input,add,send]),fetch:async()=>{}});
 await a.clickGenerate();
 assert.equal(send.clicked,true);
});


test('clickGenerate falls back to the trailing enabled composer action button',async()=>{
 const input=el({tag:'TEXTAREA',aria:'What do you want to create?'});
 const add=el({aria:'Add'});
 const settings=el({aria:'Settings'});
 const arrow=el();
 const container={parentElement:null,querySelectorAll:(sel)=>sel==='button'?[add,settings,arrow]:[]};
 input.parentElement=container;
 const a=new FlowAdapter({document:doc([input,add,settings,arrow]),fetch:async()=>{}});
 await a.clickGenerate();
 assert.equal(arrow.clicked,true);
});

test('clickGenerate never climbs to unrelated global navigation buttons', async()=>{
 const input=el({tag:'TEXTAREA',aria:'What do you want to create?'});
 const home=el({aria:'Home'});
 const help=el({aria:'Help'});
 const global={parentElement:null,querySelectorAll:(sel)=>sel==='button'?[home,help]:[]};
 const local={parentElement:global,querySelectorAll:(sel)=>sel==='button'?[]:[]};
 input.parentElement=local;
 const a=new FlowAdapter({document:doc([input,home,help]),fetch:async()=>{},location:{hostname:'flow.google.com',pathname:'/project/demo'}});
 await assert.rejects(()=>a.clickGenerate(),/send button not found|send.*not ready/i);
 assert.notEqual(home.clicked,true);
 assert.notEqual(help.clicked,true);
});

test('ensureReady rejects Flow homepage even if another textarea exists', async()=>{
 const fake=el({tag:'TEXTAREA',aria:'Search Help'});
 const a=new FlowAdapter({document:doc([fake]),fetch:async()=>{},location:{hostname:'flow.google.com',pathname:'/'}});
 await assert.rejects(()=>a.ensureReady(),/project/i);
});

test('prepare never clicks unrelated global Image controls outside the composer', async()=>{
 const input=el({tag:'TEXTAREA',aria:'What do you want to create?'});
 const globalImage=el({text:'Image'});
 const global={parentElement:null,querySelectorAll:(sel)=>sel==='button'?[globalImage]:[]};
 const local={parentElement:global,querySelectorAll:(sel)=>sel==='button'?[]:[]};
 input.parentElement=local;
 const a=new FlowAdapter({document:doc([input,globalImage]),fetch:async()=>{},location:{hostname:'flow.google.com',pathname:'/project/demo'}});
 await a.prepare({aspectRatio:'16:9',model:'Nano Banana Pro'});
 assert.notEqual(globalImage.clicked,true);
});

test('promptEditor recognizes Flow composer by placeholder text', async()=>{
 const input=el({tag:'TEXTAREA'});
 const original=input.getAttribute;
 input.getAttribute=(k)=> k==='placeholder' ? 'What do you want to create?' : original(k);
 const a=new FlowAdapter({document:doc([input]),fetch:async()=>{},location:{hostname:'flow.google.com',pathname:'/project/demo'}});
 await assert.doesNotReject(()=>a.ensureReady());
 assert.equal(a.promptEditor(),input);
});
