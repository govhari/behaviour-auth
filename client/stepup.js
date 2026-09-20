
const STYLE_ID='bioprint-stepup-style';
const CSS=`
:root{--bp-surface:#141b17;--bp-line:#34473c;--bp-fg:#e7eee9;--bp-muted:#93aa9c;--bp-accent:#c1efa6;--bp-accent-fg:#172512}
.bp-stepup{color:var(--bp-fg);font:inherit;display:grid;gap:14px}
.bp-stepup h3{margin:0;font-size:17px;font-weight:600}
.bp-stepup p{margin:0;font-size:13px;line-height:1.6;color:var(--bp-muted)}
.bp-stepup .bp-phrase{font-size:21px;letter-spacing:.3px;color:var(--bp-fg);padding:16px 0;border-block:1px solid var(--bp-line);user-select:none}
.bp-stepup input.bp-typing{width:100%;background:var(--bp-surface);color:var(--bp-fg);border:1px solid var(--bp-line);border-radius:8px;padding:12px;font:inherit;outline:none}
.bp-stepup input.bp-typing:focus{border-color:var(--bp-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--bp-accent) 22%,transparent)}
.bp-stepup .bp-arena{height:230px;position:relative;background:radial-gradient(color-mix(in srgb,var(--bp-line) 80%,transparent) 1px,transparent 1px);background-size:19px 19px;
  border:1px solid var(--bp-line);border-radius:10px;touch-action:none;overflow:hidden}
.bp-stepup .bp-arena .empty{position:absolute;top:48%;width:100%;text-align:center;font-size:12px;color:var(--bp-muted)}
.bp-stepup .target{position:absolute;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:50%;padding:0;border:0;cursor:pointer;
  background:var(--bp-accent);color:var(--bp-accent-fg);font:inherit;font-weight:700;box-shadow:0 0 0 9px color-mix(in srgb,var(--bp-accent) 12%,transparent)}
.bp-stepup .target:disabled{opacity:.4;cursor:default}
.bp-stepup .drag-goal{position:absolute;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;display:grid;place-items:center;
  border:2px dashed var(--bp-accent);color:var(--bp-accent);font-size:12px;font-weight:700}
.bp-stepup .bp-scroll{height:150px;overflow-y:auto;position:relative;border:1px solid var(--bp-line);border-radius:10px;background:var(--bp-surface);overscroll-behavior:contain}
.bp-stepup .scroll-content{height:900px;position:relative;background:repeating-linear-gradient(0deg,transparent 0 59px,var(--bp-line) 60px)}
.bp-stepup .scroll-marker{position:absolute;left:50%;transform:translate(-50%,-50%);white-space:nowrap;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;
  background:var(--bp-accent);color:var(--bp-accent-fg);font:inherit;font-weight:650}
.bp-stepup .bp-actions{display:flex;gap:10px;flex-wrap:wrap}
.bp-stepup button.bp-submit,.bp-stepup button.bp-cancel{border:1px solid transparent;border-radius:8px;padding:11px 16px;font:inherit;font-weight:650;cursor:pointer}
.bp-stepup button.bp-submit{background:var(--bp-accent);color:var(--bp-accent-fg)}
.bp-stepup button.bp-cancel{background:transparent;border-color:var(--bp-line);color:var(--bp-fg)}
.bp-stepup button:disabled{opacity:.35;cursor:default}
.bp-stepup .bp-status{min-height:18px;font-size:12px;color:var(--bp-muted)}
.bp-stepup [hidden]{display:none}`;

function installStyles(doc){
  if(doc.getElementById(STYLE_ID))return;
  const style=doc.createElement('style');style.id=STYLE_ID;style.textContent=CSS;doc.head.append(style);
}
const el=(tag,props={})=>{
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(key.includes('-')||key==='role')node.setAttribute(key,String(value));
    else node[key]=value;
  }
  return node;
};

export function createStepUp(sdk,challenge,{
  mount=null,
  title='One more behavior check',
  note=null,
  studySessionId=null,
  cancellable=true,
  onProgress=()=>{},
}={}){
  installStyles(document);
  const root=el('div',{className:'bp-stepup'});
  const heading=el('h3',{textContent:title});
  const instruction=el('p',{textContent:note??`Type the phrase, then ${challenge.interaction==='drag'?'drag the arrow to':'select'} ${challenge.targets.length} target${challenge.targets.length===1?'':'s'}.${challenge.scrollTarget?' Finally, centre and select the scroll marker.':''}`});
  const phrase=el('div',{className:'bp-phrase',textContent:challenge.phrase});
  const input=el('input',{className:'bp-typing',autocomplete:'off',autocapitalize:'off',spellcheck:false,'aria-label':'Type the phrase exactly'});
  const arena=el('div',{className:'bp-arena','aria-label':'Pointer challenge area'});
  const scrollArea=el('div',{className:'bp-scroll','aria-label':'Scroll challenge',tabIndex:0,hidden:!challenge.scrollTarget});
  const status=el('p',{className:'bp-status',role:'status'});
  const submit=el('button',{className:'bp-submit',type:'button',textContent:'Submit evidence',disabled:true});
  const cancel=el('button',{className:'bp-cancel',type:'button',textContent:'Cancel',hidden:!cancellable});
  const actions=el('div',{className:'bp-actions'});
  actions.append(submit,cancel);
  root.append(heading,instruction,phrase,input,arena,scrollArea,status,actions);
  mount?.append(root);

  let settle=null,finished=false;
  const done=new Promise(resolve=>{settle=resolve;});
  const capture=sdk.capture(challenge,{input,arena,scrollArea,studySessionId,onProgress:state=>{
    submit.disabled=!state.ready;
    if(state.error)status.textContent=state.error;
    else if(state.ready)status.textContent='Ready to submit.';
    else status.textContent=input.value===challenge.phrase?`Target ${Math.min(state.target+1,challenge.targets.length)} of ${challenge.targets.length}.`:'Type the phrase exactly to unlock the targets.';
    onProgress(state);
  }});

  const close=value=>{if(finished)return;finished=true;submit.disabled=true;cancel.disabled=true;settle(value);};
  submit.onclick=()=>{
    if(finished)return;
    try{const payload=capture.finish();finished=true;submit.disabled=true;cancel.disabled=true;settle(payload);}
    catch(e){status.textContent=e.message.replaceAll('_',' ').toLowerCase();close(null);}
  };
  cancel.onclick=()=>{capture.cancel();close(null);};

  return {
    element:root,
    done,
    focus(){input.focus();},
    cancel(){capture.cancel();close(null);},
    destroy(){capture.cancel();close(null);root.remove();},
  };
}
