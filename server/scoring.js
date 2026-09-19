import { createHash } from 'node:crypto';
import { derive, FEATURE_SCHEMA_VERSION } from './features/index.js';
import { replayFingerprint } from './security/replay.js';
import { automation } from './security/automation.js';

export const median = a => { const s = a.filter(Number.isFinite).sort((x,y)=>x-y); return s.length ? (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2 : null; };
const mad = a => median(a.map(x=>Math.abs(x-median(a))));
const floors = [12, 25, .3, 30];
export const ACTIVE_ROUNDS = 6;
export const ACTIVE_ROUNDS_RECOMMENDED = 8;
export const ACTIVE_ROUNDS_MAXIMUM = 12;
export function analyze(challenge, events) {
  if (!Array.isArray(events) || events.length > 12000) throw Error('INVALID_EVENTS');
  let last = -1, text = '', target = 0, press = null, lastScroll=null, scrollSelected=false;
  const held = new Map(), dwell = [], downs = [], paths = [], clicks = [];
  let path = [], untrusted = 0;
  const touchTask=challenge.interaction==='drag';
  for (const e of events) {
    if (!e || !Number.isFinite(e.t) || e.t < last || e.t < 0 || e.t > 180000) throw Error('INVALID_TIMELINE');
    last = e.t;
    if (e.trusted === false) untrusted++;
    if(e.type==='text'){
      if(!touchTask||typeof e.value!=='string'||e.value.length>128)throw Error('INVALID_TEXT_INPUT');
      text=e.value;
    } else if (e.type === 'keydown') {
      if(touchTask)throw Error('INVALID_KEY_SEQUENCE');
      if (typeof e.key !== 'string' || e.key.length > 24 || held.has(e.key)) throw Error('INVALID_KEY_SEQUENCE');
      held.set(e.key,e.t);
      if (e.key === 'Backspace') text = text.slice(0,-1);
      else if (e.key.length === 1) { text += e.key; downs.push(e.t); }
    } else if (e.type === 'keyup') {
      if (!held.has(e.key)) throw Error('INVALID_KEY_SEQUENCE');
      if (e.key.length === 1) dwell.push(e.t-held.get(e.key));
      held.delete(e.key);
    } else if (['move','down','up'].includes(e.type)) {
      if (![e.x,e.y].every(Number.isFinite) || e.x < 0 || e.x > 1 || e.y < 0 || e.y > 1) throw Error('INVALID_COORDINATES');
      path.push(e);
      if (e.type === 'down') { if (press) throw Error('INVALID_POINTER_SEQUENCE'); press = e; }
      if (e.type === 'up') {
        const goal = challenge.targets[target];
        const start=touchTask?challenge.dragStart:goal;
        if (!press || !goal || !start || text !== challenge.phrase || Math.hypot(e.x-goal.x,e.y-goal.y) > (goal.radius??.065) || Math.hypot(press.x-start.x,press.y-start.y) > (touchTask?.065:goal.radius??.065)) throw Error('TASK_MISMATCH');
        clicks.push(e.t-press.t); paths.push(path); path=[]; press=null; target++;
      }
    } else if(e.type==='scroll') {
      if(!Number.isFinite(e.position)||e.position<0||e.position>1)throw Error('INVALID_SCROLL');
      lastScroll=e;
    } else if(e.type==='scrollselect') {
      if(!challenge.scrollTarget||scrollSelected||target!==challenge.targets.length||!lastScroll||!Number.isFinite(e.position)||Math.abs(e.position-challenge.scrollTarget)>.07||Math.abs(e.position-lastScroll.position)>.01)throw Error('SCROLL_TASK_MISMATCH');
      scrollSelected=true;
    } else if(e.type==='focus') {
      if(typeof e.active!=='boolean')throw Error('INVALID_FOCUS');
    } else if(e.type==='motion'||e.type==='gyro') {
      if(![e.x,e.y,e.z].every(v=>Number.isFinite(v)&&Math.abs(v)<=(e.type==='gyro'?2000:200)))throw Error('INVALID_MOTION');
      if(e.type==='motion'&&['ax','ay','az'].some(k=>e[k]!==undefined)&&![e.ax,e.ay,e.az].every(v=>Number.isFinite(v)&&Math.abs(v)<=200))throw Error('INVALID_MOTION');
    } else if(e.type==='wheel') {
      if(![e.deltaX,e.deltaY].every(v=>Number.isFinite(v)&&Math.abs(v)<=1000000)||![0,1,2].includes(e.deltaMode))throw Error('INVALID_SCROLL');
    } else throw Error('INVALID_EVENT_TYPE');
    if(['move','down','up'].includes(e.type)){
      if(e.pointerType!==undefined&&!['mouse','pen','touch'].includes(e.pointerType))throw Error('INVALID_POINTER_TYPE');
      for(const [name,[min,max]] of Object.entries({pressure:[0,1],width:[0,1000],height:[0,1000],tiltX:[-90,90],tiltY:[-90,90],twist:[0,359]}))if(e[name]!==undefined&&(!Number.isFinite(e[name])||e[name]<min||e[name]>max))throw Error('INVALID_POINTER_FIELD');
    }
  }
  if (text !== challenge.phrase || target !== challenge.targets.length) throw Error('TASK_MISMATCH');
  const flights = downs.slice(1).map((t,i)=>t-downs[i]);
  const velocities = paths.flatMap(p=>{
    const chord=Math.max(.05,Math.hypot(p.at(-1).x-p[0].x,p.at(-1).y-p[0].y));
    return p.slice(1).flatMap((e,i)=>e.t>p[i].t ? [1000*Math.hypot(e.x-p[i].x,e.y-p[i].y)/(e.t-p[i].t)/chord] : []);
  });
  const rich=derive(events,challenge);
  const quality = Math.min(1,touchTask?1:dwell.length/20,velocities.length/25,(rich.timing.coarse||rich.timing.interrupted)?.5:1,challenge.scrollTarget&&!scrollSelected?0:1);
  const feature = [median(dwell),median(flights),median(velocities),median(clicks)];
  const reasons=[];
  if (untrusted) reasons.push('UNTRUSTED_EVENTS');
  if (flights.length > 15 && mad(flights)<1) reasons.push('UNIFORM_KEY_TIMING');
  if (!touchTask&&(median(dwell)<8 || median(flights)<20)) reasons.push('IMPLAUSIBLE_KEY_TIMING');
  const human=automation(events,rich,reasons),humanScore=human.score;
  const origin = events[0]?.t ?? 0;
  const signature = createHash('sha256').update(JSON.stringify(events.map(e=>[e.type,e.t-origin,e.key??e.value??null,e.x??null,e.y??null]))).digest('hex');
  return {featureSchemaVersion:FEATURE_SCHEMA_VERSION,feature,rich,replayFingerprint:replayFingerprint(events,challenge),quality,humanScore,humanReasons:human.signals.map(s=>s.code),automation:human,signature,complete:held.size===0&&!press};
}
export function model(samples) {
  return {center:floors.map((_,j)=>median(samples.map(s=>s[j]))),scale:floors.map((f,j)=>Math.max(f,1.4826*mad(samples.map(s=>s[j]).filter(Number.isFinite))))};
}
export const FEATURE_NAMES = ['dwell','flight','velocity','click'];
export function similarity(feature, profile) {
  const parts=feature.map((x,j)=>Number.isFinite(x)&&Number.isFinite(profile.center[j])?Math.exp(-.5*Math.min(4,Math.abs(x-profile.center[j])/profile.scale[j])**2):null);
  const mean=values=>{const v=values.filter(Number.isFinite);return v.length?Math.exp(v.reduce((s,x)=>s+Math.log(Math.max(x,1e-6)),0)/v.length):null;};
  const terms=feature.map((value,j)=>({name:FEATURE_NAMES[j]??`feature ${j}`,
    value:Number.isFinite(value)?value:null,center:profile.center[j]??null,scale:profile.scale[j]??null,
    z:Number.isFinite(value)&&Number.isFinite(profile.center[j])?Math.abs(value-profile.center[j])/profile.scale[j]:null,
    weight:1,score:parts[j]}));
  return { score:mean(parts), modalities:{keyboard:mean(parts.slice(0,2)),pointer:mean(parts.slice(2))},
    features:{keyboard:terms.slice(0,2),pointer:terms.slice(2)} };
}
export const ACTIVE_ACCEPT_RULE = { percentile:.1, floor:.65, ceiling:.9 };
export function calibrate(samples) {
  const scores=samples.map((s,i)=>similarity(s,model(samples.filter((_,j)=>i!==j))).score);
  const sorted=scores.filter(Number.isFinite).sort((a,b)=>a-b),raw=sorted.length?sorted[Math.floor(ACTIVE_ACCEPT_RULE.percentile*(sorted.length-1))]:null;
  return {...model(samples),threshold:raw===null?ACTIVE_ACCEPT_RULE.ceiling:Math.max(ACTIVE_ACCEPT_RULE.floor,Math.min(ACTIVE_ACCEPT_RULE.ceiling,raw)),calibration:{method:'leave-one-round-out',rule:`clamp(p${ACTIVE_ACCEPT_RULE.percentile*100}(LOO),${ACTIVE_ACCEPT_RULE.floor},${ACTIVE_ACCEPT_RULE.ceiling})`,scores,provisional:true}};
}
