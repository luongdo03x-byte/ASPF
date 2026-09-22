import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const runtimeSource = await readFile(new URL('../src/flow/content-runtime.js', import.meta.url), 'utf8');

class TestFile {
  constructor(parts,name,{type=''}={}){
    this.parts=parts;
    this.name=name;
    this.type=type;
  }
}

function element({tagName='TEXTAREA', attrs={}, disabled=false, text=''}={}) {
  return {
    tagName,
    disabled,
    innerText:text,
    textContent:text,
    value:'',
    parentElement:null,
    children:[],
    getAttribute(name){ return attrs[name] ?? null; },
    querySelectorAll(){ return []; },
    focus(){},
    click(){ this.clicked=true; },
    dispatchEvent(){},
  };
}

function matchesSelector(el, selector) {
  if (selector === 'textarea') return el.tagName === 'TEXTAREA';
  if (selector === '[contenteditable="true"]') return el.getAttribute('contenteditable') === 'true';
  if (selector === '[contenteditable]') return el.getAttribute('contenteditable') != null;
  if (selector === '[role="textbox"]') return el.getAttribute('role') === 'textbox';
  if (selector === '[role="img"]') return el.getAttribute('role') === 'img';
  if (selector === 'input[type="text"]') return el.tagName === 'INPUT' && el.getAttribute('type') === 'text';
  if (selector === 'input[type="file"]') return el.tagName === 'INPUT' && el.getAttribute('type') === 'file';
  if (selector === 'button') return el.tagName === 'BUTTON';
  if (selector === 'img') return el.tagName === 'IMG';
  if (selector === 'div,span,p,label') return ['DIV','SPAN','P','LABEL'].includes(el.tagName);
  return false;
}

function makeDocument(elements=[]) {
  return {
    querySelectorAll(selector) {
      if (selector.includes(',')) return selector.split(',').flatMap(part => elements.filter(x => matchesSelector(x, part.trim())));
      return elements.filter(x => matchesSelector(x, selector));
    },
    querySelector(){ return null; },
    body:{innerText:''},
  };
}

function loadRuntime({document, location={hostname:'flow.google.com', pathname:'/project/demo'}}) {
  const context = vm.createContext({
    document,
    location,
    console,
    setTimeout,
    clearTimeout,
    fetch: async()=>{ throw new Error('unused'); },
    DataTransfer: class {
      constructor(){
        this.files=[];
        this.items={add:file=>this.files.push(file)};
      }
    },
    Event: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    InputEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    KeyboardEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    MouseEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    PointerEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    DragEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    File: TestFile,
    getComputedStyle: el=>el?._computedStyle||{filter:'none',opacity:'1',backgroundImage:''},
  });
  vm.runInContext(runtimeSource, context, {filename:'content-runtime.js'});
  return new context.FlowBatchRuntime.FlowRuntime();
}

test('production Flow runtime recognizes the composer from its placeholder', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const runtime=loadRuntime({document:makeDocument([editor])});
  await assert.doesNotReject(()=>runtime.ensureReady());
  assert.equal(runtime.promptEditor(), editor);
});

test('production Flow runtime never selects a global Send button outside the composer', ()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  editor.parentElement={parentElement:null,querySelectorAll(){return [];}};
  const globalSend=element({tagName:'BUTTON',attrs:{'aria-label':'Send'}});
  const runtime=loadRuntime({document:makeDocument([editor,globalSend])});
  assert.equal(runtime.generateButton(), undefined);
  assert.notEqual(globalSend.clicked, true);
});

test('production runtime matches the current Flow composer shape from the user screenshot', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const attach=element({tagName:'BUTTON',attrs:{'aria-label':'Attach'}});
  const settings=element({tagName:'BUTTON',attrs:{'aria-label':'Settings'}});
  const arrow=element({tagName:'BUTTON'});
  const composer={
    parentElement:null,
    querySelectorAll(selector){ return selector==='button' ? [add,agent,attach,settings,arrow] : []; }
  };
  editor.parentElement=composer;
  const runtime=loadRuntime({document:makeDocument([editor,add,agent,attach,settings,arrow])});
  await runtime.ensureReady();
  await runtime.setPrompt('scene prompt');
  assert.equal(editor.value,'scene prompt');
  assert.equal(runtime.generateButton(),arrow);
});


test('production runtime finds an unlabeled editor through the visible Flow placeholder overlay', async()=>{
  const hint=element({tagName:'DIV',text:'What do you want to create?'});
  const editor=element({tagName:'DIV',attrs:{role:'textbox',contenteditable:'plaintext-only'}});
  delete editor.value;
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const settings=element({tagName:'BUTTON',attrs:{'aria-label':'Settings'}});
  const arrow=element({tagName:'BUTTON'});
  const composer={
    parentElement:null,
    querySelectorAll(selector){
      if(selector==='button') return [add,agent,settings,arrow];
      if(selector==='textarea,[contenteditable],[role="textbox"],input[type="text"]') return [editor];
      if(selector==='textarea') return [];
      if(selector==='[contenteditable]') return [editor];
      if(selector==='[role="textbox"]') return [editor];
      if(selector==='input[type="text"]') return [];
      return [];
    }
  };
  hint.parentElement=composer;
  editor.parentElement=composer;
  const runtime=loadRuntime({document:makeDocument([hint,editor,add,agent,settings,arrow])});
  await assert.doesNotReject(()=>runtime.ensureReady());
  assert.equal(runtime.promptEditor(), editor);
});


test('clickGenerate submits using the composer arrow button', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const settings=element({tagName:'BUTTON',attrs:{'aria-label':'Settings'}});
  const arrow=element({tagName:'BUTTON'});
  let dispatched=[];
  arrow.dispatchEvent=(evt)=>{dispatched.push(evt.type);};
  arrow.click=()=>{arrow.clicked=true; arrow.disabled=true;};
  const composer={
    parentElement:null,
    querySelectorAll(selector){ return selector==='button' ? [add,agent,settings,arrow] : []; }
  };
  editor.parentElement=composer;
  const doc=makeDocument([editor,add,agent,settings,arrow]);
  const runtime=loadRuntime({document:doc});
  await runtime.setPrompt('scene prompt');
  await runtime.clickGenerate();
  assert.equal(arrow.clicked, true);
  assert.ok(dispatched.includes('click'));
});


test('detects a newly rendered role=img visual card when Flow does not use an img element', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const settings=element({tagName:'BUTTON',attrs:{'aria-label':'Settings'}});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,settings,arrow]:[];}};
  editor.parentElement=composer;
  const card=element({tagName:'DIV',attrs:{role:'img','aria-label':'Generated image'}});
  card.getBoundingClientRect=()=>({left:210,top:155,width:350,height:200,right:560,bottom:355});
  let includeCard=false;
  const doc={
    body:{innerText:''},
    querySelector(){return null;},
    querySelectorAll(selector){
      const base=[editor,add,agent,settings,arrow];
      const all=includeCard?[...base,card]:base;
      if(selector.includes(',')) return selector.split(',').flatMap(part=>all.filter(x=>matchesSelector(x,part.trim())));
      return all.filter(x=>matchesSelector(x,selector));
    }
  };
  const runtime=loadRuntime({document:doc});
  runtime.beforeVisual=runtime.visualSnapshot();
  includeCard=true;
  const result=await runtime.waitForNewVisual(50);
  assert.equal(result.rect.x,210);
  assert.equal(result.rect.y,155);
  assert.equal(result.rect.width,350);
  assert.equal(result.rect.height,200);
});


test('prepare skips Flow settings and only validates that the composer exists', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const settings=element({tagName:'BUTTON',attrs:{'aria-label':'Settings'}});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,settings,arrow]:[];}};
  editor.parentElement=composer;
  const runtime=loadRuntime({document:makeDocument([editor,add,agent,settings,arrow])});
  await assert.doesNotReject(()=>runtime.prepare({outputs:1}));
  assert.notEqual(settings.clicked,true);
});

test('prepare does not require Agent settings to exist in manual-settings mode', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,arrow]:[];}};
  editor.parentElement=composer;
  const runtime=loadRuntime({document:makeDocument([editor,add,agent,arrow])});
  await assert.doesNotReject(()=>runtime.prepare({outputs:1}));
});


test('uses the unlabeled penultimate composer icon as Settings only inside a compact composer', ()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const extra=element({tagName:'BUTTON'});
  const sliders=element({tagName:'BUTTON'});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,extra,sliders,arrow]:[];}};
  editor.parentElement=composer;
  const runtime=loadRuntime({document:makeDocument([editor,add,agent,extra,sliders,arrow])});
  assert.equal(runtime.generateButton(),arrow);
  assert.equal(runtime.settingsButton(),sliders);
});


test('prefers the full composer ancestor over an inner two-button group', ()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const extra=element({tagName:'BUTTON'});
  const sliders=element({tagName:'BUTTON'});
  const arrow=element({tagName:'BUTTON'});
  const outer={
    parentElement:null,
    querySelectorAll(selector){return selector==='button'?[add,agent,extra,sliders,arrow]:[];}
  };
  const inner={
    parentElement:outer,
    querySelectorAll(selector){return selector==='button'?[add,agent]:[];}
  };
  editor.parentElement=inner;
  const runtime=loadRuntime({document:makeDocument([editor,add,agent,extra,sliders,arrow])});
  assert.deepEqual(runtime.composerButtons(),[add,agent,extra,sliders,arrow]);
  assert.equal(runtime.generateButton(),arrow);
  assert.equal(runtime.settingsButton(),sliders);
});


test('finds Settings by geometry even when DOM ancestors hide the right-side controls', ()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  editor.getBoundingClientRect=()=>({left:380,top:800,width:480,height:120,right:860,bottom:920});

  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  add.getBoundingClientRect=()=>({left:390,top:890,width:28,height:28,right:418,bottom:918});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  agent.getBoundingClientRect=()=>({left:425,top:887,width:55,height:32,right:480,bottom:919});
  const extra=element({tagName:'BUTTON'});
  extra.getBoundingClientRect=()=>({left:775,top:889,width:28,height:28,right:803,bottom:917});
  const sliders=element({tagName:'BUTTON'});
  sliders.getBoundingClientRect=()=>({left:808,top:889,width:28,height:28,right:836,bottom:917});
  const arrow=element({tagName:'BUTTON'});
  arrow.getBoundingClientRect=()=>({left:840,top:887,width:32,height:32,right:872,bottom:919});

  const inner={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent]:[];}};
  editor.parentElement=inner;

  const runtime=loadRuntime({document:makeDocument([editor,add,agent,extra,sliders,arrow])});
  assert.equal(runtime.generateButton(),arrow);
  assert.equal(runtime.settingsButton(),sliders);
});


test('uploadReference opens Add and waits for Flow to create the file input', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const arrow=element({tagName:'BUTTON'});
  const fileInput=element({tagName:'INPUT',attrs:{type:'file',accept:'image/*'}});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,arrow]:[];}};
  editor.parentElement=composer;

  let showInput=false;
  add.click=()=>{add.clicked=true;showInput=true;};

  const doc={
    body:{innerText:''},
    querySelector(){return null;},
    querySelectorAll(selector){
      const all=showInput?[editor,add,agent,arrow,fileInput]:[editor,add,agent,arrow];
      if(selector.includes(','))return selector.split(',').flatMap(part=>all.filter(x=>matchesSelector(x,part.trim())));
      return all.filter(x=>matchesSelector(x,selector));
    }
  };
  fileInput.dispatchEvent=evt=>{if(evt.type==='change')doc.body.innerText='S01_IMG01.png';};

  const runtime=loadRuntime({document:doc});
  await runtime.uploadReference(new TestFile([new Uint8Array([1,2,3])],'S01_IMG01.png',{type:'image/png'}));
  assert.equal(add.clicked,true);
  assert.equal(fileInput.files.length,1);
  assert.equal(fileInput.files[0].name,'S01_IMG01.png');
});


test('rejects a non-File reference before DataTransfer.add', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,arrow]:[];}};
  editor.parentElement=composer;
  const runtime=loadRuntime({document:makeDocument([editor,add,agent,arrow])});
  await assert.rejects(()=>runtime.uploadReference({name:'bad.png'}),/not a browser File/i);
});


test('waitForSettledVisual waits until a blurred result becomes stable', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,arrow]:[];}};
  editor.parentElement=composer;

  const card=element({tagName:'DIV',attrs:{role:'img','aria-label':'Generated image'}});
  card.getBoundingClientRect=()=>({left:210,top:155,width:420,height:240,right:630,bottom:395});
  card._computedStyle={filter:'blur(8px)',opacity:'1',backgroundImage:''};

  let includeCard=false;
  const doc={
    body:{innerText:''},
    querySelector(){return null;},
    querySelectorAll(selector){
      const base=[editor,add,agent,arrow];
      const all=includeCard?[...base,card]:base;
      if(selector.includes(','))return selector.split(',').flatMap(part=>all.filter(x=>matchesSelector(x,part.trim())));
      return all.filter(x=>matchesSelector(x,selector));
    }
  };

  const runtime=loadRuntime({document:doc});
  runtime.resultStableMs=30;
  runtime.resultSettleMs=15;
  runtime.resultPollMs=5;
  runtime.beforeVisual=runtime.visualSnapshot();
  includeCard=true;

  const started=Date.now();
  setTimeout(()=>{card._computedStyle={filter:'none',opacity:'1',backgroundImage:''};},25);
  const result=await runtime.waitForSettledVisual(250);
  const elapsed=Date.now()-started;

  assert.equal(result.el,card);
  assert.ok(elapsed>=55, `expected settle delay after blur cleared, got ${elapsed}ms`);
});

test('waitForSettledVisual resets stability when the generated image source changes', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,arrow]:[];}};
  editor.parentElement=composer;

  const img=element({tagName:'IMG',attrs:{'aria-label':'Generated image'}});
  img.complete=true;
  img.naturalWidth=1024;
  img.naturalHeight=576;
  img.src='https://example.test/preview.png';
  img.currentSrc=img.src;
  img.getBoundingClientRect=()=>({left:210,top:155,width:420,height:236,right:630,bottom:391});
  img._computedStyle={filter:'none',opacity:'1',backgroundImage:''};

  let includeImg=false;
  const doc={
    body:{innerText:''},
    querySelector(){return null;},
    querySelectorAll(selector){
      const base=[editor,add,agent,arrow];
      const all=includeImg?[...base,img]:base;
      if(selector.includes(','))return selector.split(',').flatMap(part=>all.filter(x=>matchesSelector(x,part.trim())));
      return all.filter(x=>matchesSelector(x,selector));
    }
  };

  const runtime=loadRuntime({document:doc});
  runtime.resultStableMs=30;
  runtime.resultSettleMs=15;
  runtime.resultPollMs=5;
  runtime.before=new Set();
  runtime.beforeVisual=runtime.visualSnapshot();
  includeImg=true;

  const started=Date.now();
  setTimeout(()=>{img.src='https://example.test/final.png';img.currentSrc=img.src;},20);
  const result=await runtime.waitForSettledVisual(250);
  const elapsed=Date.now()-started;

  assert.equal(result.sourceUrl,'https://example.test/final.png');
  assert.ok(elapsed>=50, `expected stability timer reset after source change, got ${elapsed}ms`);
});
