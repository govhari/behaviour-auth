import { capturePassive } from './passive.js';
import { captureContinuous } from './continuous.js';
import { createAmbientSession } from './ambient.js';
export function randomId(){
  if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&0x0f|0x40;b[8]=b[8]&0x3f|0x80;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export class BioPrintSDK {
  static init(options){return new BioPrintSDK(options);}
  constructor({endpoint='/bioprint'}={}){
    this.endpoint=endpoint;
    try{this.installId=localStorage.getItem('bioprint.install')||randomId();localStorage.setItem('bioprint.install',this.installId);}catch{this.installId=randomId();}
  }
  context(){return {installId:this.installId,class:this.deviceClass||(matchMedia('(pointer: coarse)').matches?'touch':'desktop-pointer'),scroll:this.scrollChallenge===true};}
  token(){
    try{const match=document.cookie.match(/(?:^|;\s*)bioprint_csrf=([a-f0-9]{32})(?:;|$)/);if(match)return match[1];}catch{/* cookies may be unavailable */}
    return this.csrfToken??null;
  }
  async request(path,body,key){
    const response=await fetch(this.endpoint+path,{
      method:'POST',
      credentials:'include',
      headers:{'Content-Type':'application/json',...(key?{'X-Enrollment-Key':key}:{}),...((()=>{const t=this.token();return t?{'X-BioPrint-CSRF':t}:{};})())},
      body:JSON.stringify(body),
    });
    const result=await response.json();
    if(result&&typeof result.csrfToken==='string')this.csrfToken=result.csrfToken;
    if(!response.ok)throw Error(result.error);return result;
  }
  async startAmbientCollection({root=document,view=null,studySessionId=null,onWindow=()=>{},onEvent=null}={}){
    if(this.ambientStarting)return this.ambientStarting;
    this.stopAmbientCollection();
    this.ambientStarting=(async()=>{
      try{
        const session=await this.request('/ambient/start',{device:this.context()});
        this.ambient=createAmbientSession(this,session,{root,view,studySessionId,onWindow,onEvent});
        return this.ambient;
      }finally{this.ambientStarting=null;}
    })();
    return this.ambientStarting;
  }
  stopAmbientCollection(){this.ambient?.stop();this.ambient=null;}
  ambientId(){return this.ambient?.ambientId??null;}
  startEnrollment(userId,key){return this.request('/enroll/start',{userId},key);}
  startEnrollmentFlow(userId,key){return this.request('/enrollment/start',{userId},key);}
  startDeviceEnrollment(userId,key){return this.request('/enrollment/device/start',{userId,device:this.context()},key);}
  completeEnrollmentFlow(userId,flow){return this.request('/enrollment/complete',{userId,...flow,ambientId:this.ambientId()});}
  passiveChallenge(userId,enrollment){return this.request(enrollment?'/enrollment/passive/challenge':'/login/start',{userId,device:this.context(),...enrollment});}
  capturePassive(challenge,elements){this.stop?.();const capture=capturePassive(challenge,elements);this.stop=capture.cancel;return capture;}
  submitPassive(payload,{enrollment,password}={}){return this.request(enrollment?'/enrollment/passive/sample':'/login/verify',{...payload,...enrollment,...(enrollment?{}:{password,ambientId:this.ambientId()})});}
  stepUpChallenge(userId,loginId){return this.request('/login/challenge',{userId,loginId,device:this.context()});}
  finishStepUp(payload,loginId){return this.request('/login/complete',{...payload,loginId});}
  startMonitoring(userId,loginId){return this.request('/monitor/start',{userId,loginId,device:this.context()});}
  monitorChallenge(userId,monitorId){return this.request('/monitor/challenge',{userId,monitorId});}
  captureContinuous(challenge,scope){return captureContinuous(challenge,scope);}
  submitMonitor(payload){return this.request('/monitor/sample',payload);}
  stopMonitoring(userId,monitorId){return this.request('/monitor/stop',{userId,monitorId});}
  challenge(userId,enrollment){return this.request(enrollment?'/enroll/challenge':'/auth/challenge',{userId,...enrollment,device:this.context()});}
  completeEnrollment(userId,enrollment){return this.request('/enroll/complete',{userId,...enrollment});}
  async enableMotion(){
    if(typeof DeviceMotionEvent==='undefined')return false;
    if(typeof DeviceMotionEvent.requestPermission==='function'&&await DeviceMotionEvent.requestPermission()!=='granted')return false;
    this.motionEnabled=true;return true;
  }
  capture(challenge,{input,arena,scrollArea,onProgress=()=>{},studySessionId=null}){
    this.stop?.();const controller=new AbortController(),events=[],held=new Map();let target=0,overflow=false,scrolled=!challenge.scrollTarget,lastTime=0,activePointer=null;
    const dragTask=challenge.interaction==='drag';
    const origin=performance.now(),signal=controller.signal;
    const add=(e,data)=>{if(events.length>=12000){overflow=true;return;}const eventTime=e.timeStamp>origin&&e.timeStamp<performance.now()+1000?e.timeStamp-origin:performance.now()-origin;const t=Math.max(lastTime,eventTime);lastTime=t;events.push({...data,t,trusted:e.isTrusted});};
    const listen=(el,name,fn,opts={})=>el?.addEventListener(name,fn,{...opts,signal});
    const progress=()=>onProgress({ready:target===challenge.targets.length&&scrolled&&held.size===0,target});
    input.value='';input.disabled=false;arena.replaceChildren();if(scrollArea){scrollArea.replaceChildren();scrollArea.hidden=!challenge.scrollTarget;}
    const button=document.createElement('button');button.className='target';button.type='button';button.disabled=true;
    const goal=document.createElement('span');goal.className='drag-goal';goal.setAttribute('aria-hidden','true');if(dragTask)arena.append(goal);
    const place=()=>{const g=challenge.targets[target];if(!g){button.remove();goal.remove();progress();return;}const start=dragTask?challenge.dragStart:g;button.style.left=`${start.x*100}%`;button.style.top=`${start.y*100}%`;button.textContent=dragTask?'↗':String(target+1);button.setAttribute('aria-label',dragTask?`Drag to target ${target+1} of ${challenge.targets.length}`:`Target ${target+1} of ${challenge.targets.length}`);if(dragTask){goal.style.left=`${g.x*100}%`;goal.style.top=`${g.y*100}%`;goal.textContent=String(target+1);}};
    const resize=()=>{const g=challenge.targets[target];if(!g?.radius)return;const el=dragTask?goal:button;el.style.width=`${g.radius*200}%`;el.style.height=`${g.radius*200}%`;};
    arena.append(button);place();resize();
    listen(input,'keydown',e=>{
      if(dragTask)return;
      if(e.isComposing||e.key==='Process'){onProgress({ready:false,error:'IME input is unavailable for this controlled typing task.'});return;}
      if(e.repeat){e.preventDefault();return;}if(e.ctrlKey||e.metaKey||e.altKey||['ArrowLeft','ArrowRight','Home','End','Delete'].includes(e.key)){e.preventDefault();return;}
      input.setSelectionRange(input.value.length,input.value.length);
      if(e.key.length===1||['Backspace','Shift'].includes(e.key)){const id=e.code||e.key;if(!held.has(id)&&![...held.values()].includes(e.key)){held.set(id,e.key);add(e,{type:'keydown',key:e.key,code:e.code,repeat:e.repeat});}}
    });
    listen(input,'keyup',e=>{const id=e.code||e.key,key=held.get(id);if(held.delete(id)){add(e,{type:'keyup',key,code:e.code});progress();}});
    for(const name of ['paste','drop','cut'])listen(input,name,e=>e.preventDefault());
    listen(input,'beforeinput',e=>{if(!dragTask&&e.inputType!=='insertText'&&e.inputType!=='deleteContentBackward')e.preventDefault();});
    listen(input,'input',e=>{if(dragTask)add(e,{type:'text',value:input.value});button.disabled=input.value!==challenge.phrase;});
    for(const [name,type] of [['pointermove','move'],['pointerdown','down'],['pointerup','up']])listen(arena,name,e=>{
      if(input.value!==challenge.phrase||target>=challenge.targets.length||!e.isPrimary)return;
      if(dragTask&&type==='move'&&activePointer===null)return;
      if(type==='down'){if(e.target!==button||activePointer!==null)return;activePointer=e.pointerId;button.setPointerCapture?.(e.pointerId);}
      if(type==='up'&&activePointer!==e.pointerId)return;
      const r=arena.getBoundingClientRect(),samples=type==='move'?(e.getCoalescedEvents?.()??[]):[];
      for(const sample of samples.length?samples:[e]){const x=(sample.clientX-r.left)/r.width,y=(sample.clientY-r.top)/r.height;if(x<0||x>1||y<0||y>1)continue;const fields={};for(const k of ['pressure','width','height','tiltX','tiltY','twist'])if(Number.isFinite(sample[k]))fields[k]=sample[k];add(sample,{type,x,y,pointerType:sample.pointerType||e.pointerType,...fields});}
      if(dragTask&&type==='move'){button.style.left=`${Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*100}%`;button.style.top=`${Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))*100}%`;}
      if(type==='up'){activePointer=null;target++;place();resize();}
    });
    listen(arena,'pointercancel',e=>{activePointer=null;add(e,{type:'focus',active:false});onProgress({ready:false,error:'Pointer capture interrupted. Start a fresh challenge.'});});
    if(challenge.scrollTarget&&scrollArea){
      const content=document.createElement('div');content.className='scroll-content';const marker=document.createElement('button');marker.type='button';marker.className='scroll-marker';marker.textContent='Select this marker';content.append(marker);scrollArea.append(content);scrollArea.scrollTop=0;
      marker.style.top=`${challenge.scrollTarget*(900-160)+80}px`;
      const position=()=>scrollArea.scrollTop/Math.max(1,scrollArea.scrollHeight-scrollArea.clientHeight);
      listen(scrollArea,'scroll',e=>{if(target===challenge.targets.length)add(e,{type:'scroll',position:position()});});
      listen(scrollArea,'wheel',e=>{if(target===challenge.targets.length)add(e,{type:'wheel',deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode});},{passive:true});
      listen(marker,'click',e=>{if(target!==challenge.targets.length)return;if(Math.abs(position()-challenge.scrollTarget)>.07){onProgress({ready:false,error:'Move the marker to the center of the scroll panel.'});return;}add(e,{type:'scrollselect',position:position()});scrolled=true;marker.disabled=true;progress();});
    }
    listen(document,'visibilitychange',e=>add(e,{type:'focus',active:!document.hidden}));
    listen(window,'blur',e=>add(e,{type:'focus',active:false}));
    listen(window,'focus',e=>add(e,{type:'focus',active:true}));
    let lastMotion=0;if(this.motionEnabled)listen(window,'devicemotion',e=>{
      if(performance.now()-lastMotion<50)return;lastMotion=performance.now();
      const a=e.accelerationIncludingGravity,linear=e.acceleration,g=e.rotationRate;
      if(a&&[a.x,a.y,a.z].every(Number.isFinite))add(e,{type:'motion',x:a.x,y:a.y,z:a.z,...(linear&&[linear.x,linear.y,linear.z].every(Number.isFinite)?{ax:linear.x,ay:linear.y,az:linear.z}:{})});
      if(g&&[g.alpha,g.beta,g.gamma].every(Number.isFinite))add(e,{type:'gyro',x:g.alpha,y:g.beta,z:g.gamma});
    });
    this.stop=()=>{controller.abort();input.disabled=true;button.disabled=true;};input.focus();
    return {finish:()=>{this.stop();if(overflow)throw Error('CAPTURE_LIMIT_REACHED');return {challengeId:challenge.challengeId,nonce:challenge.nonce,userId:challenge.userId,events,studySessionId};},cancel:this.stop};
  }
  verify(payload,enrollment){return this.request(enrollment?'/enroll/sample':'/auth/verify',{...payload,...enrollment});}
  async authenticate({userId,input,arena,scrollArea,onProgress}){const challenge=await this.challenge(userId);return {challenge,...this.capture(challenge,{input,arena,scrollArea,onProgress})};}
}
