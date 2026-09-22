import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const runtimeSource = await readFile(new URL('../src/flow/content-runtime.js', import.meta.url), 'utf8');

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
    DataTransfer: class {},
    Event: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    InputEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    KeyboardEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    MouseEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
    PointerEvent: class { constructor(type, init={}){ this.type=type; Object.assign(this, init); } },
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


test('prepare forces Flow image output count to one from composer settings', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const agent=element({tagName:'BUTTON',text:'Agent'});
  const settings=element({tagName:'BUTTON',attrs:{'aria-label':'Settings'}});
  const arrow=element({tagName:'BUTTON'});
  const one=element({tagName:'BUTTON',text:'1'});
  const two=element({tagName:'BUTTON',text:'2',attrs:{'aria-pressed':'true'}});
  const outputRow={
    parentElement:null,
    querySelectorAll(selector){
      if(selector.includes('button')) return [one,two];
      return [];
    }
  };
  const outputLabel=element({tagName:'DIV',text:'Number of outputs'});
  outputLabel.parentElement=outputRow;
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,agent,settings,arrow]:[];}};
  editor.parentElement=composer;
  let settingsOpened=false;
  settings.click=()=>{settingsOpened=true;settings.clicked=true;};
  one.click=()=>{one.clicked=true;one.getAttribute=(name)=>name==='aria-pressed'?'true':null;};
  const base=makeDocument([editor,add,agent,settings,arrow,outputLabel,one,two]);
  const document={...base,querySelectorAll(selector){
    if(selector==='div,span,p,label,legend') return settingsOpened?[outputLabel]:[];
    return base.querySelectorAll(selector);
  }};
  const runtime=loadRuntime({document});
  await runtime.prepare({outputs:1});
  assert.equal(settings.clicked,true);
  assert.equal(one.clicked,true);
});

test('prepare refuses to generate when output count cannot be safely forced to one', async()=>{
  const editor=element({attrs:{placeholder:'What do you want to create?'}});
  const add=element({tagName:'BUTTON',attrs:{'aria-label':'Add'}});
  const settings=element({tagName:'BUTTON',attrs:{'aria-label':'Settings'}});
  const arrow=element({tagName:'BUTTON'});
  const composer={parentElement:null,querySelectorAll(selector){return selector==='button'?[add,settings,arrow]:[];}};
  editor.parentElement=composer;
  const runtime=loadRuntime({document:makeDocument([editor,add,settings,arrow])});
  await assert.rejects(()=>runtime.prepare({outputs:1}),/output|settings/i);
});
