(() => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=s=>String(s||'').trim().toLowerCase();
  const semantic=el=>[el.getAttribute?.('aria-label'),el.getAttribute?.('aria-placeholder'),el.getAttribute?.('placeholder'),el.getAttribute?.('data-placeholder'),el.getAttribute?.('title'),el.getAttribute?.('data-tooltip'),el.getAttribute?.('data-tooltip-text'),el.getAttribute?.('data-testid'),el.innerText,el.textContent].filter(Boolean).join(' ');
  const find=(elements,patterns)=>[...elements].find(el=>patterns.some(p=>norm(semantic(el)).includes(norm(p)))&&!el.disabled);
  const error=(code,message,retryable=true,stage=null)=>Object.assign(new Error(message),{code,retryable,stage});
  class FlowRuntime {
    constructor(){this.before=new Set();this.beforeVisual=new Set();this.timeoutMs=180000;this.confirmedOutputCount=null;}
    isProjectPage(){return /(^|\.)flow\.google\.com$/i.test(location.hostname||'')&&/^\/project\//.test(location.pathname||'');}
    editorCandidates(root=document){
      const selectors=['textarea','[contenteditable]','[role="textbox"]','input[type="text"]'];
      const seen=new Set();
      const out=[];
      for(const selector of selectors){
        for(const el of root.querySelectorAll?.(selector)||[]){
          if(seen.has(el)||el.disabled||el.getAttribute?.('contenteditable')==='false'||el.getAttribute?.('aria-hidden')==='true')continue;
          seen.add(el);out.push(el);
        }
      }
      return out;
    }
    promptHints(){
      const match=/what do you want to create|prompt|describe|mô tả|câu lệnh/i;
      const selectors=['[placeholder]','[aria-placeholder]','[data-placeholder]','div,span,p,label'];
      const seen=new Set();
      const hints=[];
      for(const selector of selectors){
        for(const el of document.querySelectorAll?.(selector)||[]){
          if(seen.has(el)||!match.test(semantic(el)))continue;
          seen.add(el);hints.push(el);
        }
      }
      return hints.sort((a,b)=>semantic(a).length-semantic(b).length);
    }
    promptEditor(){
      const match=/what do you want to create|prompt|describe|mô tả|câu lệnh/i;
      const editors=this.editorCandidates();
      const direct=editors.find(x=>match.test(semantic(x)));
      if(direct)return direct;
      for(const hint of this.promptHints()){
        let node=hint.parentElement||null;
        for(let depth=0;node&&depth<7;depth++,node=node.parentElement){
          const local=this.editorCandidates(node);
          if(local.length===1)return local[0];
          if(local.length>1){
            const semanticLocal=local.find(x=>match.test(semantic(x)));
            if(semanticLocal)return semanticLocal;
          }
        }
      }
      for(const editor of editors){
        let node=editor.parentElement||null;
        for(let depth=0;node&&depth<7;depth++,node=node.parentElement){
          const buttons=[...(node.querySelectorAll?.('button')||[])];
          const composerControls=buttons.filter(b=>/add|attach|settings?|option|plus|agent|tệp|file/i.test(semantic(b)));
          if(buttons.length>=2&&buttons.length<=10&&composerControls.length>=1)return editor;
        }
      }
      return undefined;
    }
    diagnostics(){return {editors:this.editorCandidates().length,hints:this.promptHints().length,buttons:(document.querySelectorAll?.('button')||[]).length};}
    composerButtons(){
      const editor=this.promptEditor();
      if(!editor)return [];
      let node=editor.parentElement||null;
      for(let depth=0;node&&depth<5;depth++,node=node.parentElement){
        const local=[...(node.querySelectorAll?.('button')||[])];
        if(local.length<2||local.length>8)continue;
        const hasComposerControl=local.some(b=>/add|attach|settings?|option|plus|agent|tệp|file/i.test(semantic(b)));
        if(hasComposerControl)return local;
      }
      return [];
    }
    generateButton(){
      const buttons=this.composerButtons();
      if(!buttons.length)return undefined;
      const patterns=['generate','tạo','send','submit','gửi','run'];
      const semanticAny=buttons.find(el=>patterns.some(p=>norm(semantic(el)).includes(norm(p))));
      if(semanticAny)return semanticAny;
      const negative=/add|attach|upload|settings?|option|menu|tool|plus|agent|image|ảnh|tệp|file|home|help|back|close|project|account|profile|expand|fullscreen/i;
      const candidates=buttons.filter(b=>!negative.test(semantic(b)));
      return candidates[candidates.length-1];
    }
    settingsButton(){
      const buttons=this.composerButtons();
      return buttons.find(b=>/settings?|options?|preferences?|generation settings|tune|adjust|cài đặt|tùy chọn/i.test(semantic(b)));
    }
    outputLabels(){
      const pattern=/number of outputs|outputs? per|outputs?|số lượng đầu ra|số ảnh|số kết quả/i;
      return [...(document.querySelectorAll?.('div,span,p,label,legend')||[])].filter(el=>pattern.test(semantic(el)));
    }
    outputControlRoot(){
      for(const label of this.outputLabels()){
        let node=label.parentElement||null;
        for(let depth=0;node&&depth<5;depth++,node=node.parentElement){
          const controls=[...(node.querySelectorAll?.('button,[role="radio"],[role="option"],[role="combobox"],input[type="radio"],select')||[])];
          if(controls.length)return {label,node,controls};
        }
      }
      return null;
    }
    controlValue(el){
      const direct=el?.value;
      if(direct!=null&&String(direct).trim()!=='')return String(direct).trim();
      const attr=el?.getAttribute?.('value');
      if(attr!=null&&String(attr).trim()!=='')return String(attr).trim();
      const visible=String(el?.innerText||el?.textContent||'').trim();
      if(visible)return visible;
      return String(semantic(el)||'').trim();
    }
    isSelected(el){
      return el?.checked===true||el?.selected===true||el?.getAttribute?.('aria-checked')==='true'||el?.getAttribute?.('aria-pressed')==='true'||el?.getAttribute?.('data-state')==='checked'||el?.getAttribute?.('data-selected')==='true';
    }
    async waitForOutputControl(timeoutMs=2500){
      const start=Date.now();
      while(Date.now()-start<timeoutMs){const root=this.outputControlRoot();if(root)return root;await wait(100);}return null;
    }
    exactOutputChoice(controls,count){
      const exact=String(count);
      return controls.find(el=>{
        const value=this.controlValue(el);
        if(value===exact)return true;
        const text=norm(semantic(el));
        return new RegExp(`^${exact}\\s*(output|outputs|image|images|ảnh)?$`,'i').test(text);
      });
    }
    async ensureOutputCount(count=1){
      count=Number(count);
      if(!Number.isFinite(count)||count<1)throw error('INVALID_OUTPUT_COUNT',`Invalid output count: ${count}`,false,'prepare');
      if(this.confirmedOutputCount===count)return;
      let root=this.outputControlRoot();
      if(!root){
        const settings=this.settingsButton();
        if(!settings)throw error('SETTINGS_BUTTON_NOT_FOUND','Flow composer Settings/Options button not found; refusing to generate with unknown output count',false,'prepare');
        this.dispatchPress(settings);
        root=await this.waitForOutputControl();
      }
      if(!root)throw error('OUTPUT_COUNT_CONTROL_NOT_FOUND','Flow Number of outputs setting not found; refusing to generate multiple outputs',false,'prepare');
      const select=root.controls.find(el=>String(el.tagName||'').toLowerCase()==='select');
      if(select){
        if(String(select.value)!==String(count)){
          select.value=String(count);
          select.dispatchEvent?.(new Event('input',{bubbles:true}));
          select.dispatchEvent?.(new Event('change',{bubbles:true}));
        }
        if(String(select.value)!==String(count))throw error('OUTPUT_COUNT_NOT_CONFIRMED',`Flow output count did not change to ${count}`,false,'prepare');
        this.confirmedOutputCount=count;
        return;
      }
      let choice=this.exactOutputChoice(root.controls,count);
      const combo=root.controls.find(el=>el.getAttribute?.('type')==='combobox');
      if(!choice&&combo){
        this.dispatchPress(combo);
        const start=Date.now();
        while(Date.now()-start<1500&&!choice){
          const options=[...document.querySelectorAll?.('[role="option"],button')||[]];
          choice=this.exactOutputChoice(options,count);
          if(!choice)await wait(100);
        }
      }
      if(!choice)throw error('OUTPUT_COUNT_OPTION_NOT_FOUND',`Flow output option ${count} not found`,false,'prepare');
      if(!this.isSelected(choice))this.dispatchPress(choice);
      await wait(120);
      this.confirmedOutputCount=count;
    }
    async ensureReady(){if(!this.isProjectPage())throw error('FLOW_PROJECT_REQUIRED','Open a Google Flow project before starting the batch',false,'prepare');if(!this.promptEditor()){const d=this.diagnostics();throw error('PROMPT_EDITOR_NOT_FOUND',`Flow project composer not found (editors=${d.editors}, hints=${d.hints}, buttons=${d.buttons})`,true,'prepare');}}
    async clickOption(patterns){const el=find(document.querySelectorAll('button'),patterns);if(el){el.click();await wait(100);return true;}return false;}
    async prepare(job={}){await this.ensureReady();if"job.outputs!=null)await this.ensureOutputCount(job.outputs);}
    async uploadReference(file){const input=document.querySelector('input[type="file"]');if(!input)throw error('FILE_INPUT_NOT_FOUND','Reference upload input not found,true,'reference');const beforeImgs=document.querySelectorAll('img').length;const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));const start=Date.now();while(Date.now()-start<10000){if((document.body?.innerText||'').includes(file.name)||document.querySelectorAll('img').length>beforeImgs)return;await wait(250);}throw error('REFERENCE_NOT_CONFIRMED',`Flow did not confirm reference ${file.name}`,true,'reference');}
    async setPrompt(text){const input=this.promptEditor();if(!input)throw error('PROMPT_EDITOR_NOT_FOUND','Prompt editor not found',true,'prompt');input.focus();if('value' in input){const proto=Object.getPrototypeOf(input);const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set||Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement?.prototype||{},'value')?.set||Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement?.prototype||{},'value')?.set;if(setter)setter.call(input,text);else input.value=text;}else{input.textContent=text;}input.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:text}));input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:' ',code:'Space'}));}
    snapshot(){return new Set([...document.querySelectorAll('img')].map(i=>i.currentSrc||i.src).filter(Boolean));}
    visualCandidates(){
      const seen=new Set();
      const nodes=[];
      for(const selector of ['img','canvas','[role="img"]','picture','[style*="background-image"]','[style*="background:"]']){
        for(const el of document.querySelectorAll?.(selector)||[]){if(!seen.has(el)){seen.add(el);nodes.push(el);}}
      }
      const vw=globalThis.innerWidth||1920,vh=globalThis.innerHeight||1080;
      return nodes.map(el=>{
        const r=el.getBoundingClientRect?.();
        if(!r)return null;
        const width=Number(r.width||0),height=Number(r.height||0);
        if(width<240||height<140||width>vw*.9||height>vh*.9)return null;
        if((r.right??(r.left+width))<=0||(r.bottom??(r.top+height))<=0||r.left>=vw||r.top>=vh)return null;
        const label=semantic(el);
        if(/logo|avatar|profile|icon|help|account/i.test(label)&&width<400&&height<400)return null;
        let sourceUrl=el.currentSrc||el.src||'';
        if(!sourceUrl){
          const inline=el.style?.backgroundImage||'';
          const computed=globalThis.getComputedStyle?.(el)?.backgroundImage||'';
          const m=(inline||computed).match(/url\(["']?([^"')]+)["']?\)/i);
          sourceUrl=m?.[1]||'';
        }
        const rect={x:r.left,y:r.top,width,height};
        const signature=[el.tagName||'',sourceUrl,label,Math.round(rect.x),Math.round(rect.y),Math.round(width),Math.round(height)].join('|');
        return {el,rect,sourceUrl,signature,area:width*height};
      }).filter(Boolean);
    }
    visualSnapshot(){return new Set(this.visualCandidates().map(v=>v.signature));}
    async waitForNewVisual(timeoutMs=this.timeoutMs){
      const start=Date.now();
      while(Date.now()-start<timeoutMs){
        const fresh=this.visualCandidates().filter(v=>!this.beforeVisual.has(v.signature));
        if(fresh.length){
          fresh.sort((a,b)=>a.rect.x-b.rect.x||b.area-a.area);
          return fresh[0];
        }
        await wait(300);
      }
      throw error('RESULT_TIMEOUT','Timed out waiting for generated visual card',true,'result');
    }
    dispatchPress(target){
      const rect=target.getBoundingClientRect?.()||{left:0,top:0,width:1,height:1};
      const detail={bubbles:true,cancelable:true,composed:true,button:0,buttons:1,clientX:rect.left+Math.max(1,rect.width/2),clientY:rect.top+Math.max(1,rect.height/2)};
      const send=(CtorName,type)=>{try{const Ctor=globalThis[CtorName]||Event;target.dispatchEvent(new Ctor(type,detail));}catch{target.dispatchEvent(new Event(type,{bubbles:true,cancelable:true,composed:true}));}};
      for(const [ctor,type] of [['PointerEvent','pointerover'],['MouseEvent','mouseover'],['PointerEvent','pointerdown'],['MouseEvent','mousedown'],['PointerEvent','pointerup'],['MouseEvent','mouseup'],['MouseEvent','click']])send(ctor,type);
      target.click?.();
    }
    async waitForSubmissionSignal(button, editor, startedAt=Date.now(), timeoutMs=5000){
      const initial=this.before;
      while(Date.now()-startedAt<timeoutMs){
        const after=this.snapshot();
        if([...after].some(src=>!initial.has(src)))return true;
        if(button && button.disabled)return true;
        const bodyText=(document.body?.innerText||'').toLowerCase();
        if(/generating|creating|rendering|processing/.test(bodyText))return true;
        const busy=document.querySelector?.('[aria-busy="true"],[role="progressbar"],progress');
        if(busy)return true;
        if(!editor)return true;
        const text='value' in editor ? String(editor.value||'') : String(editor.textContent||'');
        if(!text.trim())return true;
        await wait(200);
      }
      return false;
    }
    async armTrustedGenerate(){
      await this.ensureReady();
      const editor=this.promptEditor();
      let b=this.generateButton();
      const start=Date.now();
      while(b?.disabled&&Date.now()-start<3000){await wait(100);b=this.generateButton();}
      if(!b)throw error('GENERATE_BUTTON_NOT_FOUND','Flow send button not found inside the project composer',true,'generate');
      if(b.disabled)throw error('GENERATE_BUTTON_DISABLED','Flow send button is still disabled after the prompt was filled',true,'generate');
      const rect=b.getBoundingClientRect?.();
      if(!rect||rect.width<=0||rect.height<=0)throw error('GENERATE_BUTTON_NO_RECT','Flow send button has no clickable viewport rectangle',true,'generate');
      this.before=this.snapshot();
      this.beforeVisual=this.visualSnapshot();
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:rect.width,height:rect.height,devicePixelRatio:globalThis.devicePixelRatio||1};
    }
    async waitForTrustedGenerateAndCapture(){
      const editor=this.promptEditor();
      const button=this.generateButton();
      const accepted=await this.waitForSubmissionSignal(button,editor,Date.now(),5000);
      if(!accepted)throw error('SUBMIT_NOT_CONFIRMED','Flow did not react after the browser-level click',true,'generate');
      const visual=await this.waitForNewVisual();
      const src=visual.sourceUrl||'';
      if(/^blob:|^data:/i.test(src)){
        try{const response=await fetch(src);const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error(`Unexpected MIME ${blob.type}`);return blob;}
        catch(e){throw error('RESULT_FETCH_FAILED',`Could not capture generated image: ${e.message}`,true,'capture');}
      }
      return {sourceUrl:src,rect:visual.rect};
    }
    async clickGenerate(){await this.ensureReady();const editor=this.promptEditor();let b=this.generateButton();const start=Date.now();while(b?.disabled&&Date.now()-start<3000){await wait(100);b=this.generateButton();}if(!b)throw error('GENERATE_BUTTON_NOT_FOUND','Flow send button not found inside the project composer',true,'generate');if(b.disabled)throw error('GENERATE_BUTTON_DISABLED','Flow send button is still disabled after the prompt was filled',true,'generate');this.before=this.snapshot();this.dispatchPress(b);if(await this.waitForSubmissionSignal(b,editor,Date.now(),3000))return;try{editor?.focus?.();editor?.dispatchEvent?.(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',code:'Enter',ctrlKey:true}));editor?.dispatchEvent?.(new KeyboardEvent('keyup',{bubbles:true,cancelable:true,key:'Enter',code:'Enter',ctrlKey:true}));if(await this.waitForSubmissionSignal(b,editor,Date.now(),2000))return;}catch{}throw error('SUBMIT_NOT_CONFIRMED','Flow did not react after the prompt was sent',true,'generate');}
    async waitForNewImage(){const start=Date.now();while(Date.now()-start<this.timeoutMs){const candidates=[...document.querySelectorAll('img')].filter(i=>{const s=i.currentSrc||i.src;const w=i.naturalWidth||i.width||0;return s&&!this.before.has(s)&&!/^data:image\/svg/i.test(s)&&w>=256;});if(candidates.length)return candidates.sort((a,b)=>(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight))[0];await wait(500);}throw error('RESULT_TIMEOUT','Timed out waiting for generated image',true,'result');}
    async generateAndCapture(){await this.clickGenerate();const img=await this.waitForNewImage();const src=img.currentSrc||img.src;if(/^blob:|^data:/i.test(src)){try{const response=await fetch(src);const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error(`Unexpected MIME ${blob.type}`);return blob;}catch(e){throw error('RESULT_FETCH_FAILED',`Could not capture generated image: ${e.message}`,true,'capture');}}return {sourceUrl:src};}
  }
  globalThis.FlowBatchRuntime={FlowRuntime};
})();
