import { ExtensionError } from '../core/errors.js';

const wait = ms => new Promise(r=>setTimeout(r,ms));
const norm = s => String(s||'').trim().toLowerCase();
export function snapshotImageSources(document){ return new Set([...document.querySelectorAll('img')].map(i=>i.src).filter(Boolean)); }
function semanticText(el){ return [el.getAttribute?.('aria-label'),el.getAttribute?.('aria-placeholder'),el.getAttribute?.('placeholder'),el.getAttribute?.('data-placeholder'),el.getAttribute?.('title'),el.getAttribute?.('data-tooltip'),el.getAttribute?.('data-tooltip-text'),el.getAttribute?.('data-testid'),el.innerText,el.textContent].filter(Boolean).join(' '); }
function findByText(elements, patterns){ return [...elements].find(el=>patterns.some(p=>norm(semanticText(el)).includes(norm(p))) && !el.disabled); }

export class FlowAdapter {
 constructor({document=globalThis.document, fetch=globalThis.fetch, DataTransferCtor=globalThis.DataTransfer, EventCtor=globalThis.Event, timeoutMs=180000, location=globalThis.location}={}){this.document=document;this.fetch=fetch;this.DataTransferCtor=DataTransferCtor;this.EventCtor=EventCtor;this.timeoutMs=timeoutMs;this.location=location;this.beforeSources=new Set();this.confirmedOutputCount=null;}
 isProjectPage(){if(!this.location)return true;return /(^|\.)flow\.google\.com$/i.test(this.location.hostname||'') && /^\/project\//.test(this.location.pathname||'');}
 editorCandidates(root=this.document){const selectors=['textarea','[contenteditable]','[role="textbox"]','input[type="text"]'];const seen=new Set();const out=[];for(const selector of selectors){for(const el of root.querySelectorAll?.(selector)||[]){if(seen.has(el)||el.disabled||el.getAttribute?.('contenteditable')==='false'||el.getAttribute?.('aria-hidden')==='true')continue;seen.add(el);out.push(el);}}return out;}
 promptHints(){const match=/what do you want to create|prompt|describe|mô tả|câu lệnh/i;const selectors=['[placeholder]','[aria-placeholder]','[data-placeholder]','div,span,p,label'];const seen=new Set();const hints=[];for(const selector of selectors){for(const el of this.document.querySelectorAll?.(selector)||[]){if(seen.has(el)||!match.test(semanticText(el)))continue;seen.add(el);hints.push(el);}}return hints.sort((a,b)=>semanticText(a).length-semanticText(b).length);}
 promptEditor(){const match=/what do you want to create|prompt|describe|mô tả|câu lệnh/i;const editors=this.editorCandidates();const direct=editors.find(x=>match.test(semanticText(x)));if(direct)return direct;for(const hint of this.promptHints()){let node=hint.parentElement||null;for(let depth=0;node&&depth<7;depth++,node=node.parentElement){const local=this.editorCandidates(node);if(local.length===1)return local[0];if(local.length>1){const semanticLocal=local.find(x=>match.test(semanticText(x)));if(semanticLocal)return semanticLocal;}}}for(const editor of editors){let node=editor.parentElement||null;for(let depth=0;node&&depth<7;depth++,node=node.parentElement){const buttons=[...(node.querySelectorAll?.('button')||[])];const composerControls=buttons.filter(b=>/add|attach|settings?|option|plus|agent|tệp|file/i.test(semanticText(b)));if(buttons.length>=2&&buttons.length<=10&&composerControls.length>=1)return editor;}}return undefined;}
 diagnostics(){return {editors:this.editorCandidates().length,hints:this.promptHints().length,buttons:(this.document.querySelectorAll?.('button')||[]).length};}
 buttonRect(el){const r=el?.getBoundingClientRect?.();if(!r)return null;const width=Number(r.width||0),height=Number(r.height||0);if(width<=0||height<=0)return null;const left=Number(r.left||0),top=Number(r.top||0);return {left,top,right:Number(r.right??(left+width)),bottom:Number(r.bottom??(top+height)),width,height,cx:left+width/2,cy:top+height/2};}
 nearEditorButtons(){const editor=this.promptEditor();const er=this.buttonRect(editor);if(!editor||!er)return [];return [...(this.document.querySelectorAll?.('button')||[])].filter(b=>!b.disabled).map(b=>({b,r:this.buttonRect(b)})).filter(x=>x.r&&x.r.cx>=er.left-60&&x.r.cx<=er.right+60&&x.r.cy>=er.top-50&&x.r.cy<=er.bottom+100).sort((a,b)=>a.r.cx-b.r.cx).map(x=>x.b);}
 composerButtons(){
  const editor=this.promptEditor();
  if(!editor)return [];
  let node=editor.parentElement||null;
  let best=[];
  for(let depth=0;node&&depth<5;depth++,node=node.parentElement){
   const local=[...(node.querySelectorAll?.('button')||[])];
   if(local.length<2||local.length>8)continue;
   const hasComposerControl=local.some(b=>/add|attach|settings?|option|plus|agent|tệp|file/i.test(semanticText(b)));
   if(hasComposerControl&&local.length>best.length)best=local;
  }
  const geometric=this.nearEditorButtons();
  if(geometric.length>best.length&&geometric.length<=8)return geometric;
  return best;
 }
 generateButton(){
  const buttons=this.composerButtons();
  if(!buttons.length)return undefined;
  const semanticPatterns=['generate','tạo','send','submit','gửi','run'];
  const semanticAny=buttons.find(el=>semanticPatterns.some(p=>norm(semanticText(el)).includes(norm(p))));
  if(semanticAny)return semanticAny;
  const negative=/add|attach|upload|settings?|option|menu|tool|plus|agent|image|ảnh|tệp|file|home|help|back|close|project|account|profile|expand|fullscreen/i;
  const candidates=buttons.filter(b=>!negative.test(semanticText(b)));
  if(candidates.length)return candidates[candidates.length-1];
  const geometric=this.nearEditorButtons();
  return geometric[geometric.length-1];
 }
 settingsButton(){
  const buttons=this.composerButtons();
  const labeled=buttons.find(b=>{const t=norm(semanticText(b));return t.includes('settings')||t.includes('options')||t.includes('cài đặt')||t.includes('tùy chọn');});
  if(labeled)return labeled;
  const send=this.generateButton();
  const sr=this.buttonRect(send);
  if(send&&sr){
   const nearby=[...(this.document.querySelectorAll?.('button')||[])].filter(b=>b!==send&&!b.disabled).map(b=>({b,r:this.buttonRect(b)})).filter(x=>x.r&&x.r.cx<sr.cx&&Math.abs(x.r.cy-sr.cy)<=Math.max(24,sr.height*1.5)).map(x=>({b:x.b,r:x.r,gap:sr.cx-x.r.cx})).filter(x=>x.gap>0&&x.gap<=100).sort((a,b)=>a.gap-b.gap);
   for(const item of nearby){const t=norm(semanticText(item.b));if(!/add|attach|upload|plus|agent|file|tệp|image|ảnh/.test(t))return item.b;}
  }
  const sendIndex=buttons.indexOf(send);
  if(buttons.length>=4&&buttons.length<=8&&sendIndex===buttons.length-1&&sendIndex>0){const candidate=buttons[sendIndex-1];const t=norm(semanticText(candidate));if(!/add|attach|upload|plus|agent|file|tệp|image|ảnh/.test(t))return candidate;}
  return undefined;
 }
 outputLabel(){
  const nodes=[...(this.document.querySelectorAll?.('div,span,p,label,legend')||[])];
  return nodes.find(el=>{const t=norm(semanticText(el));return t.includes('number of outputs')||t==='outputs'||t.includes('số ảnh')||t.includes('số kết quả');});
 }
 outputRoot(){
  const label=this.outputLabel();
  if(label){let node=label.parentElement||null;for(let depth=0;node&&depth<5;depth++,node=node.parentElement){const controls=[...(node.querySelectorAll?.('button,[role="radio"],[role="option"],select')||[])];if(controls.length)return {node,controls};}}
  const all=[...(this.document.querySelectorAll?.('button,[role="radio"],[role="option"],select')||[])];
  const one=all.find(el=>this.controlText(el)==='1');
  if(one){let node=one.parentElement||null;for(let depth=0;node&&depth<4;depth++,node=node.parentElement){const controls=[...(node.querySelectorAll?.('button,[role="radio"],[role="option"],select')||[])];if(controls.some(el=>this.controlText(el)==='2'))return {node,controls};}}
  return null;
 }
 controlText(el){const value=String(el?.value||el?.getAttribute?.('value')||'').trim();if(value)return value;return String(el?.innerText||el?.textContent||'').trim();}
 async ensureOneOutput(){
  if(this.confirmedOutputCount===1)return;
  let root=this.outputRoot();
  if(!root){const settings=this.settingsButton();if(!settings)throw new ExtensionError('SETTINGS_BUTTON_NOT_FOUND','Flow Settings/Options button not found; cannot enforce one output',{retryable:false,stage:'prepare'});settings.click();const start=Date.now();while(Date.now()-start<2500&&!root){await wait(100);root=this.outputRoot();}}
  if(!root)throw new ExtensionError('OUTPUT_COUNT_CONTROL_NOT_FOUND','Flow Number of outputs control not found; generation stopped to avoid multiple images',{retryable:false,stage:'prepare'});
  const select=root.controls.find(el=>String(el.tagName||'').toLowerCase()==='select');
  if(select){if(String(select.value)!=='1'){select.value='1';select.dispatchEvent?.(new this.EventCtor('input',{bubbles:true}));select.dispatchEvent?.(new this.EventCtor('change',{bubbles:true}));}if(String(select.value)!=='1')throw new ExtensionError('OUTPUT_COUNT_NOT_CONFIRMED','Could not set Flow outputs to 1',{retryable:false,stage:'prepare'});this.confirmedOutputCount=1;return;}
  const one=root.controls.find(el=>{const t=this.controlText(el).toLowerCase();return t==='1'||t==='1 output'||t==='1 outputs'||t==='1 image'||t==='1 images'||t==='1 ảnh';});
  if(!one)throw new ExtensionError('OUTPUT_COUNT_OPTION_NOT_FOUND','Flow output option 1 not found',{retryable:false,stage:'prepare'});
  const selected=one.checked===true||one.getAttribute?.('aria-checked')==='true'||one.getAttribute?.('aria-pressed')==='true'||one.getAttribute?.('data-state')==='checked';
  if(!selected)one.click();
  await wait(150);this.confirmedOutputCount=1;
 }
 async ensureReady(){if(!this.isProjectPage())throw new ExtensionError('FLOW_PROJECT_REQUIRED','Open a Google Flow project before starting the batch',{retryable:false,stage:'prepare'});if(!this.promptEditor()){const d=this.diagnostics();throw new ExtensionError('PROMPT_EDITOR_NOT_FOUND',`Flow project composer not found (editors=${d.editors}, hints=${d.hints}, buttons=${d.buttons})`,{retryable:true,stage:'prepare'});}}
 async clickOption(patterns,{required=false,code='OPTION_NOT_FOUND'}={}){const buttons=this.document.querySelectorAll('button');const el=findByText(buttons,patterns);if(el){el.click();await wait(100);return true;}if(required)throw new ExtensionError(code,`Flow option not found: ${patterns[0]}`,{retryable:true,stage:'prepare'});return false;}
 async prepare(_job={}){await this.ensureReady();}
 async clearReferenceInputs(){/* Flow may keep prior chips; current V1 relies on each dependent generation view clearing after generation. */}
 async uploadReference(file){const input=this.document.querySelectorAll('input[type="file"]')[0];if(!input)throw new ExtensionError('FILE_INPUT_NOT_FOUND','Reference upload input not found',{retryable:true,stage:'reference'});if(!this.DataTransferCtor)throw new ExtensionError('DATATRANSFER_UNAVAILABLE','Browser DataTransfer is unavailable',{retryable:false,stage:'reference'});const dt=new this.DataTransferCtor();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new this.EventCtor('change',{bubbles:true}));await wait(250);}
 async setPrompt(text){const input=this.promptEditor();if(!input)throw new ExtensionError('PROMPT_EDITOR_NOT_FOUND','Prompt editor not found',{retryable:true,stage:'prompt'});input.focus?.();if('value' in input)input.value=text;else input.textContent=text;input.dispatchEvent?.(new this.EventCtor('input',{bubbles:true,inputType:'insertText',data:text}));input.dispatchEvent?.(new this.EventCtor('change',{bubbles:true}));}
 async clickGenerate(){await this.ensureReady();let b=this.generateButton();const started=Date.now();while(b?.disabled&&Date.now()-started<3000){await wait(100);b=this.generateButton();}if(!b)throw new ExtensionError('GENERATE_BUTTON_NOT_FOUND','Flow send button not found inside the project composer',{retryable:true,stage:'generate'});if(b.disabled)throw new ExtensionError('GENERATE_BUTTON_DISABLED','Flow send button is still disabled after the prompt was filled',{retryable:true,stage:'generate'});this.beforeSources=snapshotImageSources(this.document);b.click();}
 async waitForNewImage(){const started=Date.now();while(Date.now()-started<this.timeoutMs){for(const img of this.document.querySelectorAll('img')){if(img.src&&!this.beforeSources.has(img.src)&&!/^data:image\/svg/i.test(img.src))return img;}await wait(500);}throw new ExtensionError('RESULT_TIMEOUT','Timed out waiting for a new generated image',{retryable:true,stage:'result'});}
 async blobFromImage(img){if(!img?.src)throw new ExtensionError('RESULT_URL_MISSING','Generated image URL missing',{retryable:true,stage:'capture'});try{const res=await this.fetch(img.src,{credentials:'include'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const blob=await res.blob();if(!blob.type?.startsWith('image/'))throw new Error(`Unexpected MIME ${blob.type}`);return blob;}catch(e){throw new ExtensionError('RESULT_FETCH_FAILED',`Could not capture generated image: ${e.message}`,{retryable:true,stage:'capture'});}}
 async generateAndCapture(job){await this.clickGenerate();const img=await this.waitForNewImage(job);return this.blobFromImage(img);}
}
