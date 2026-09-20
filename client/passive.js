export function capturePassive(challenge,{form,username,password,submit,studySessionId=null,onEvent=null}) {
  let bound=challenge??null;
  const controller=new AbortController(),signal=controller.signal,events=[],held=new Map();
  const origin=performance.now();let position=0,lastTime=0,lastTyping=-Infinity,overflow=false,pointerHeld=false,lastSubmitClick=-Infinity;
  const add=(e,data)=>{
    if(events.length>=12000){overflow=true;return;}
    const raw=e?.timeStamp,elapsed=raw>=origin&&raw<=performance.now()+1000?raw-origin:performance.now()-origin;
    lastTime=Math.max(lastTime,elapsed);
    const event={...data,t:lastTime,trusted:e?.isTrusted!==false};
    events.push(event);
    if(onEvent)try{onEvent(event);}catch{/* a broken reporter is not a capture failure */}
  };
  const listen=(el,type,handler)=>el.addEventListener(type,handler,{signal});
  for(const [field,input] of [['username',username],['password',password]]){
    listen(input,'keydown',e=>{
      if(e.repeat||e.isComposing||e.key==='Process'||e.key==='Unidentified')return;
      const id=e.code||e.key;if(held.has(id))return;
      const action=e.key==='Backspace'||e.key==='Delete'?'correction':e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey?'character':['Shift','Control','Alt','Meta','CapsLock'].includes(e.key)?'modifier':'navigation';
      const data={field,position:position++,action,...(field==='username'?{key:e.key,code:e.code}:{})};held.set(id,data);lastTyping=performance.now();add(e,{type:'keydown',...data});
    });
    listen(input,'keyup',e=>{const id=e.code||e.key,data=held.get(id);if(data){add(e,{type:'keyup',...data});held.delete(id);}});
    listen(input,'input',e=>{
      const source=e.isComposing||e.inputType?.includes('Composition')||e.inputType==='insertReplacementText'?'composition':performance.now()-lastTyping<250&&['insertText','deleteContentBackward','deleteContentForward'].includes(e.inputType)?'typing':'autofill';
      add(e,{type:'input',field,source});
    });
    listen(input,'focus',e=>add(e,{type:'focus',field,active:true}));
    listen(input,'blur',e=>add(e,{type:'focus',field,active:false}));
  }
  const targetFor=e=>submit.contains(e.target)?'submit':e.target===username?'username':e.target===password?'password':'form';
  for(const [type,eventName] of [['move','pointermove'],['down','pointerdown'],['up','pointerup']])listen(form,eventName,e=>{
    if(!e.isPrimary)return;
    const target=targetFor(e);
    if(type==='down'){if(pointerHeld)return;pointerHeld=true;}
    if(type==='up'&&!pointerHeld)return;
    const rect=form.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width,y=(e.clientY-rect.top)/rect.height;
    if(x<0||x>1||y<0||y>1)return;
    const button=submit.getBoundingClientRect();const extra=target==='submit'?{buttonX:Math.max(0,Math.min(1,(e.clientX-button.left)/button.width)),buttonY:Math.max(0,Math.min(1,(e.clientY-button.top)/button.height))}:{};
    add(e,{type,x,y,target,pointerType:e.pointerType||'mouse',...extra});
    if(type==='up'){pointerHeld=false;if(target==='submit')lastSubmitClick=performance.now();}
  });
  listen(form,'pointercancel',e=>{pointerHeld=false;add(e,{type:'cancel'});});
  listen(document,'visibilitychange',e=>add(e,{type:'focus',field:'form',active:!document.hidden}));
  listen(window,'blur',e=>add(e,{type:'focus',field:'form',active:false}));
  const cancel=()=>controller.abort();
  return {cancel,bind:next=>{bound=next;},bound:()=>bound,finish:e=>{
    add(e,{type:'submit',method:performance.now()-lastSubmitClick<1000?'pointer':'keyboard'});cancel();
    if(overflow)throw Error('CAPTURE_LIMIT_REACHED');
    if(!bound)throw Error('CHALLENGE_NOT_BOUND');
    return {challengeId:bound.challengeId,nonce:bound.nonce,userId:bound.userId,username:username.value,events,studySessionId,hints:{webdriver:navigator.webdriver===true}};
  }};
}
