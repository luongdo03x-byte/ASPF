(() => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=s=>String(s||'').trim().toLowerCase();
  const semantic=el=>[el.getAttribute?.('aria-label'),el.getAttribute?.('aria-placeholder'),el.getAttribute?.('placeholder'),el.getAttribute?.('data-placeholder'),el.getAttribute?.('title'),el.getAttribute?.('data-tooltip'),el.getAttribute?.('data-tooltip-text'),el.getAttribute?.('data-testid'),el.innerText,el.textContent].filter(Boolean).join(' ');
  const find=(elements,patterns)=>[...elements].find(el=>patterns.some(p=>norm(semantic(el)).includes(norm(p)))&&!el.disabled);
  const error=(code,message,retryable=true,stage=null)=>Object.assign(new Error(message),{code,retryable,stage});
  class FlowRuntime {
    constructor(){this.before=new Set();this.beforeVisual=new Set();this.timeoutMs=180000;this.resultStableMs=4000;this.resultSettleMs=2000;this.resultPollMs=350;this.confirmedOutputCount=null;}
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
    buttonRect(el){
      const r=el?.getBoundingClientRect?.();
      if(!r)return null;
      const width=Number(r.width||0),height=Number(r.height||0);
      if(width<=0||height<=0)return null;
      const left=Number(r.left||0),top=Number(r.top||0);
      return {left,top,right:Number(r.right??(left+width)),bottom:Number(r.bottom??(top+height)),width,height,cx:left+width/2,cy:top+height/2};
    }
    nearEditorButtons(){
      const editor=this.promptEditor();
      const er=this.buttonRect(editor);
      if(!editor||!er)return [];
      return [...(document.querySelectorAll?.('button')||[])]
        .filter(b=>!b.disabled)
        .map(b=>({b,r:this.buttonRect(b)}))
        .filter(x=>x.r&&x.r.cx>=er.left-60&&x.r.cx<=er.right+60&&x.r.cy>=er.top-50&&x.r.cy<=er.bottom+100)
        .sort((a,b)=>a.r.cx-b.r.cx)
        .map(x=>x.b);
    }
    composerButtons(){
      const editor=this.promptEditor();
      if(!editor)return [];
      let node=editor.parentElement||null;
      let best=[];
      for(let depth=0;node&&depth<5;depth++,node=node.parentElement){
        const local=[...(node.querySelectorAll?.('button')||[])];
        if(local.length<2||local.length>8)continue;
        const hasComposerControl=local.some(b=>/add|attach|settings?|option|plus|agent|tệp|file/i.test(semantic(b)));
        if(hasComposerControl&&local.length>best.length)best=local;
      }
      const geometric=this.nearEditorButtons();
      if(geometric.length>best.length&&geometric.length<=8)return geometric;
      return best;
    }
    generateButton(){
      const buttons=this.composerButtons();
      if(!buttons.length)return undefined;
      const patterns=['generate','tạo','send','submit','gửi','run'];
      const semanticAny=buttons.find(el=>patterns.some(p=>norm(semantic(el)).includes(norm(p))));
      if(semanticAny)return semanticAny;
      const negative=/add|attach|upload|settings?|option|menu|tool|plus|agent|image|ảnh|tệp|file|home|help|back|close|project|account|profile|expand|fullscreen/i;
      const candidates=buttons.filter(b=>!negative.test(semantic(b)));
      if(candidates.length)return candidates[candidates.length-1];
      const geometric=this.nearEditorButtons();
      return geometric[geometric.length-1];
    }
    settingsButton(){
      const buttons=this.composerButtons();
      const labeled=buttons.find(b=>{
        const t=norm(semantic(b));
        return t.includes('settings')||t.includes('options')||t.includes('cài đặt')||t.includes('tùy chọn');
      });
      if(labeled)return labeled;
      const send=this.generateButton();
      const sr=this.buttonRect(send);
      if(send&&sr){
        const nearby=[...(document.querySelectorAll?.('button')||[])]
          .filter(b=>b!==send&&!b.disabled)
          .map(b=>({b,r:this.buttonRect(b)}))
          .filter(x=>x.r&&x.r.cx<sr.cx&&Math.abs(x.r.cy-sr.cy)<=Math.max(24,sr.height*1.5))
          .map(x=>({b:x.b,r:x.r,gap:sr.cx-x.r.cx}))
          .filter(x=>x.gap>0&&x.gap<=100)
          .sort((a,b)=>a.gap-b.gap);
        for(const item of nearby){
          const t=norm(semantic(item.b));
          if(!/add|attach|upload|plus|agent|file|tệp|image|ảnh/.test(t))return item.b;
        }
      }
      const sendIndex=buttons.indexOf(send);
      if(buttons.length>=4&&buttons.length<=8&&sendIndex===buttons.length-1&&sendIndex>0){
        const candidate=buttons[sendIndex-1];
        const t=norm(semantic(candidate));
        if(!/add|attach|upload|plus|agent|file|tệp|image|ảnh/.test(t))return candidate;
      }
      return undefined;
    }
    outputLabel(){
      const nodes=[...(document.querySelectorAll?.('div,span,p,label,legend')||[])];
      return nodes.find(el=>{
        const t=norm(semantic(el));
        return t.includes('number of outputs')||t==='outputs'||t.includes('số ảnh')||t.includes('số kết quả');
      });
    }
    outputRoot(){
      const label=this.outputLabel();
      if(label){
        let node=label.parentElement||null;
        for(let depth=0;node&&depth<5;depth++,node=node.parentElement){
          const controls=[...(node.querySelectorAll?.('button,[role="radio"],[role="option"],select')||[])];
          if(controls.length)return {node,controls};
        }
      }
      const all=[...(document.querySelectorAll?.('button,[role="radio"],[role="option"],select')||[])];
      const one=all.find(el=>this.controlText(el)==='1');
      if(one){
        let node=one.parentElement||null;
        for(let depth=0;node&&depth<4;depth++,node=node.parentElement){
          const controls=[...(node.querySelectorAll?.('button,[role="radio"],[role="option"],select')||[])];
          const hasTwo=controls.some(el=>this.controlText(el)==='2');
          if(hasTwo)return {node,controls};
        }
      }
      return null;
    }
    controlText(el){
      const value=String(el?.value||el?.getAttribute?.('value')||'').trim();
      if(value)return value;
      return String(el?.innerText||el?.textContent||'').trim();
    }
    async ensureOneOutput(){
      if(this.confirmedOutputCount===1)return;
      let root=this.outputRoot();
      if(!root){
        const settings=this.settingsButton();
        if(!settings)throw error('SETTINGS_BUTTON_NOT_FOUND','Flow Settings/Options button not found; cannot enforce one output',false,'prepare');
        this.dispatchPress(settings);
        const start=Date.now();
        while(Date.now()-start<2500&&!root){await wait(100);root=this.outputRoot();}
      }
      if(!root)throw error('OUTPUT_COUNT_CONTROL_NOT_FOUND','Flow Number of outputs control not found; generation stopped to avoid multiple images',false,'prepare');
      const select=root.controls.find(el=>String(el.tagName||'').toLowerCase()==='select');
      if(select){
        if(String(select.value)!=='1'){
          select.value='1';
          select.dispatchEvent?.(new Event('input',{bubbles:true}));
          select.dispatchEvent?.(new Event('change',{bubbles:true}));
        }
        if(String(select.value)!=='1')throw error('OUTPUT_COUNT_NOT_CONFIRMED','Could not set Flow outputs to 1',false,'prepare');
        this.confirmedOutputCount=1;
        return;
      }
      const one=root.controls.find(el=>{
        const t=this.controlText(el).toLowerCase();
        return t==='1'||t==='1 output'||t==='1 outputs'||t==='1 image'||t==='1 images'||t==='1 ảnh';
      });
      if(!one)throw error('OUTPUT_COUNT_OPTION_NOT_FOUND','Flow output option 1 not found',false,'prepare');
      const selected=one.checked===true||one.getAttribute?.('aria-checked')==='true'||one.getAttribute?.('aria-pressed')==='true'||one.getAttribute?.('data-state')==='checked';
      if(!selected)this.dispatchPress(one);
      await wait(150);
      this.confirmedOutputCount=1;
    }
    async ensureReady(){if(!this.isProjectPage())throw error('FLOW_PROJECT_REQUIRED','Open a Google Flow project before starting the batch',false,'prepare');if(!this.promptEditor()){const d=this.diagnostics();throw error('PROMPT_EDITOR_NOT_FOUND',`Flow project composer not found (editors=${d.editors}, hints=${d.hints}, buttons=${d.buttons})`,true,'prepare');}}
    async clickOption(patterns){const el=find(document.querySelectorAll('button'),patterns);if(el){el.click();await wait(100);return true;}return false;}
    async prepare(_job={}){await this.ensureReady();}
    referenceInput(){
      const inputs=[...(document.querySelectorAll?.('input[type="file"]')||[])].filter(x=>!x.disabled);
      return inputs.find(x=>/image/i.test(String(x.getAttribute?.('accept')||'')))||inputs[0];
    }
    addMediaButton(){
      const buttons=this.composerButtons();
      const labeled=buttons.find(b=>{
        const t=norm(semantic(b));
        return /(^|\s)(add|attach|upload|plus|thêm|đính kèm)(\s|$)/i.test(t);
      });
      if(labeled)return labeled;
      const all=this.nearEditorButtons();
      const agent=all.find(b=>norm(semantic(b)).includes('agent'));
      const ar=this.buttonRect(agent);
      if(agent&&ar){
        const left=all
          .filter(b=>b!==agent)
          .map(b=>({b,r:this.buttonRect(b)}))
          .filter(x=>x.r&&x.r.cx<ar.cx&&Math.abs(x.r.cy-ar.cy)<=Math.max(24,ar.height*1.5))
          .map(x=>({b:x.b,gap:ar.cx-x.r.cx}))
          .filter(x=>x.gap>0&&x.gap<=100)
          .sort((a,b)=>a.gap-b.gap);
        if(left.length)return left[0].b;
      }
      return undefined;
    }
    uploadMenuButton(){
      const nodes=[...(document.querySelectorAll?.('[role="menuitem"],[role="option"],[role="menu"] button,[role="listbox"] button')||[])];
      const patterns=['upload image','upload','add image','image','media','file','computer','device','ảnh','tệp','tải lên'];
      return nodes.find(el=>{
        if(el.disabled)return false;
        const t=norm(semantic(el));
        return patterns.some(p=>t.includes(norm(p)))&&!/agent|settings|option|send|generate|home|project/.test(t);
      });
    }
    async waitForReferenceInput(timeoutMs=2200){
      const start=Date.now();
      while(Date.now()-start<timeoutMs){
        const input=this.referenceInput();
        if(input)return input;
        await wait(100);
      }
      return null;
    }
    makeTransfer(file){
      try{
        const dt=new DataTransfer();
        dt.items.add(file);
        return dt;
      }catch(e){
        throw error('REFERENCE_DATATRANSFER_FAILED','Could not place reference image into DataTransfer: '+e.message,false,'reference');
      }
    }
    async confirmReference(file,beforeImgs,timeoutMs=10000){
      const start=Date.now();
      while(Date.now()-start<timeoutMs){
        if((document.body?.innerText||'').includes(file.name))return true;
        if((document.querySelectorAll?.('img')||[]).length>beforeImgs)return true;
        const editor=this.promptEditor();
        if(editor){
          let node=editor.parentElement||null;
          for(let depth=0;node&&depth<4;depth++,node=node.parentElement){
            const imgs=node.querySelectorAll?.('img,[role="img"]')||[];
            if(imgs.length)return true;
          }
        }
        await wait(200);
      }
      return false;
    }
    async dropReference(file,beforeImgs){
      const editor=this.promptEditor();
      if(!editor)return false;
      const dt=this.makeTransfer(file);
      let target=editor;
      for(let depth=0;target&&depth<3;depth++,target=target.parentElement){
        try{
          const opts={bubbles:true,cancelable:true,composed:true,dataTransfer:dt};
          for(const type of ['dragenter','dragover','drop']){
            const Ctor=globalThis.DragEvent||Event;
            target.dispatchEvent?.(new Ctor(type,opts));
          }
          if(await this.confirmReference(file,beforeImgs,1800))return true;
        }catch{}
      }
      return false;
    }
    async uploadReference(file){
      if(!this.isProjectPage())throw error('FLOW_PROJECT_REQUIRED_REFERENCE','Flow project is no longer open before reference upload',false,'reference');
      if(!(file instanceof File))throw error('REFERENCE_NOT_FILE','Reference payload is not a browser File',false,'reference');
      const beforeImgs=(document.querySelectorAll?.('img')||[]).length;
      let input=this.referenceInput();
      if(!input){
        const add=this.addMediaButton();
        if(add){
          this.dispatchPress(add);
          await wait(120);
          if(!this.isProjectPage())throw error('REFERENCE_NAVIGATED_AWAY','Reference Add control navigated away from the Flow project',false,'reference');
          input=await this.waitForReferenceInput(1200);
        }
      }
      if(!input){
        const menu=this.uploadMenuButton();
        if(menu){
          this.dispatchPress(menu);
          await wait(120);
          if(!this.isProjectPage())throw error('REFERENCE_NAVIGATED_AWAY','Reference upload menu navigated away from the Flow project',false,'reference');
          input=await this.waitForReferenceInput(1600);
        }
      }
      if(input){
        const dt=this.makeTransfer(file);
        try{input.files=dt.files;}catch(e){throw error('REFERENCE_FILE_ASSIGN_FAILED','Could not attach reference file: '+e.message,false,'reference');}
        input.dispatchEvent?.(new Event('input',{bubbles:true}));
        input.dispatchEvent?.(new Event('change',{bubbles:true}));
        if(await this.confirmReference(file,beforeImgs))return;
      }
      if(await this.dropReference(file,beforeImgs))return;
      throw error('REFERENCE_UPLOAD_UNAVAILABLE','Flow reference uploader did not appear after opening the Add menu',false,'reference');
    }
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
    isFreshVisual(v){
      if(v.sourceUrl&&this.before.has(v.sourceUrl))return false;
      return !this.beforeVisual.has(v.signature);
    }
    visualFingerprint(v){
      const el=v?.el;
      const style=globalThis.getComputedStyle?.(el)||{};
      const naturalWidth=Number(el?.naturalWidth||el?.width||0);
      const naturalHeight=Number(el?.naturalHeight||el?.height||0);
      const text=norm(semantic(el));
      return [
        v?.sourceUrl||'',
        Math.round(v?.rect?.x||0),
        Math.round(v?.rect?.y||0),
        Math.round(v?.rect?.width||0),
        Math.round(v?.rect?.height||0),
        naturalWidth,
        naturalHeight,
        String(style.filter||''),
        String(style.opacity||''),
        text.replace(/\s+/g,' ').slice(0,160)
      ].join('|');
    }
    visualIsBusy(v){
      const el=v?.el;
      if(!el)return true;
      const tag=String(el.tagName||'').toUpperCase();
      if(tag==='IMG'){
        if(el.complete===false)return true;
        const nw=Number(el.naturalWidth||0),nh=Number(el.naturalHeight||0);
        if((Number.isFinite(nw)&&nw>0&&nw<256)||(Number.isFinite(nh)&&nh>0&&nh<140))return true;
        if((el.src||el.currentSrc)&&(!nw||!nh))return true;
      }
      const style=globalThis.getComputedStyle?.(el)||{};
      const filter=String(style.filter||'').toLowerCase();
      const opacity=Number.parseFloat(style.opacity);
      if(/blur\((?!0(?:px)?\))/i.test(filter))return true;
      if(Number.isFinite(opacity)&&opacity<0.95)return true;
      let node=el;
      for(let depth=0;node&&depth<4;depth++,node=node.parentElement){
        if(node.getAttribute?.('aria-busy')==='true')return true;
        const state=norm(node.getAttribute?.('data-state')||node.getAttribute?.('data-loading')||'');
        if(/loading|generating|processing|rendering|pending/.test(state))return true;
        const ownText=norm(node.innerText||node.textContent||'');
        if(/generating|creating|rendering|processing|loading|preparing/.test(ownText))return true;
        if(/(^|\s)\d{1,3}%($|\s)/.test(ownText))return true;
        const busy=node.querySelector?.('[aria-busy="true"],[role="progressbar"],progress,[data-loading="true"]');
        if(busy)return true;
      }
      return false;
    }
    sameVisualSlot(a,b){
      if(!a?.rect||!b?.rect)return false;
      const ax=a.rect.x+a.rect.width/2,ay=a.rect.y+a.rect.height/2;
      const bx=b.rect.x+b.rect.width/2,by=b.rect.y+b.rect.height/2;
      return Math.abs(ax-bx)<=Math.max(80,a.rect.width*.35)&&Math.abs(ay-by)<=Math.max(80,a.rect.height*.35);
    }
    pickFreshVisual(previous=null){
      const fresh=this.visualCandidates().filter(v=>this.isFreshVisual(v));
      if(!fresh.length)return null;
      if(previous){
        const same=fresh.filter(v=>this.sameVisualSlot(previous,v));
        if(same.length){
          same.sort((a,b)=>b.area-a.area);
          return same[0];
        }
      }
      fresh.sort((a,b)=>a.rect.x-b.rect.x||a.rect.y-b.rect.y||b.area-a.area);
      return fresh[0];
    }
    async waitForSettledVisual(timeoutMs=this.timeoutMs){
      const start=Date.now();
      let tracked=null;
      let lastFingerprint='';
      let stableSince=0;
      while(Date.now()-start<timeoutMs){
        const candidate=this.pickFreshVisual(tracked);
        if(!candidate){
          tracked=null;lastFingerprint='';stableSince=0;
          await wait(this.resultPollMs);
          continue;
        }
        tracked=candidate;
        if(this.visualIsBusy(candidate)){
          lastFingerprint='';stableSince=0;
          await wait(this.resultPollMs);
          continue;
        }
        const fingerprint=this.visualFingerprint(candidate);
        if(fingerprint!==lastFingerprint){
          lastFingerprint=fingerprint;
          stableSince=Date.now();
          await wait(this.resultPollMs);
          continue;
        }
        if(Date.now()-stableSince>=this.resultStableMs){
          await wait(this.resultSettleMs);
          const finalCandidate=this.pickFreshVisual(candidate);
          if(!finalCandidate||this.visualIsBusy(finalCandidate)){
            lastFingerprint='';stableSince=0;
            await wait(this.resultPollMs);
            continue;
          }
          if(this.visualFingerprint(finalCandidate)!==fingerprint){
            tracked=finalCandidate;
            lastFingerprint=this.visualFingerprint(finalCandidate);
            stableSince=Date.now();
            await wait(this.resultPollMs);
            continue;
          }
          return finalCandidate;
        }
        await wait(this.resultPollMs);
      }
      throw error('RESULT_NOT_SETTLED','Generated image did not become fully rendered and stable before timeout',false,'result');
    }
    async waitForNewVisual(timeoutMs=this.timeoutMs){
      return this.waitForSettledVisual(timeoutMs);
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
      const visual=await this.waitForSettledVisual();
      const src=visual.sourceUrl||'';
      if(/^blob:|^data:/i.test(src)){
        try{const response=await fetch(src);const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error(`Unexpected MIME ${blob.type}`);return blob;}
        catch(e){throw error('RESULT_FETCH_FAILED',`Could not capture generated image: ${e.message}`,true,'capture');}
      }
      return {sourceUrl:src,rect:visual.rect};
    }
    async clickGenerate(){await this.ensureReady();const editor=this.promptEditor();let b=this.generateButton();const start=Date.now();while(b?.disabled&&Date.now()-start<3000){await wait(100);b=this.generateButton();}if(!b)throw error('GENERATE_BUTTON_NOT_FOUND','Flow send button not found inside the project composer',true,'generate');if(b.disabled)throw error('GENERATE_BUTTON_DISABLED','Flow send button is still disabled after the prompt was filled',true,'generate');this.before=this.snapshot();this.beforeVisual=this.visualSnapshot();this.dispatchPress(b);if(await this.waitForSubmissionSignal(b,editor,Date.now(),3000))return;try{editor?.focus?.();editor?.dispatchEvent?.(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',code:'Enter',ctrlKey:true}));editor?.dispatchEvent?.(new KeyboardEvent('keyup',{bubbles:true,cancelable:true,key:'Enter',code:'Enter',ctrlKey:true}));if(await this.waitForSubmissionSignal(b,editor,Date.now(),2000))return;}catch{}throw error('SUBMIT_NOT_CONFIRMED','Flow did not react after the prompt was sent',true,'generate');}
    async waitForNewImage(){const start=Date.now();while(Date.now()-start<this.timeoutMs){const candidates=[...document.querySelectorAll('img')].filter(i=>{const s=i.currentSrc||i.src;const w=i.naturalWidth||i.width||0;return s&&!this.before.has(s)&&!/^data:image\/svg/i.test(s)&&w>=256;});if(candidates.length)return candidates.sort((a,b)=>(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight))[0];await wait(500);}throw error('RESULT_TIMEOUT','Timed out waiting for generated image',true,'result');}
    async generateAndCapture(){await this.clickGenerate();const visual=await this.waitForSettledVisual();const src=visual.sourceUrl||'';if(/^blob:|^data:/i.test(src)){try{const response=await fetch(src);const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error(`Unexpected MIME ${blob.type}`);return blob;}catch(e){throw error('RESULT_FETCH_FAILED',`Could not capture generated image: ${e.message}`,false,'capture');}}return {sourceUrl:src,rect:visual.rect};}
  }
  globalThis.FlowBatchRuntime={FlowRuntime};
})();
