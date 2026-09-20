import { createHash } from 'node:crypto';
import { median, mad } from './features/index.js';
import { fuse } from './matching/index.js';

export const AMBIENT_VERSION = 'ambient-1';
export const AMBIENT_SCHEMA_VERSION = 1;
export const AMBIENT_WINDOW_MS = 10000;
export const AMBIENT_MIN_WINDOWS = 6;
export const AMBIENT_MAX_EVENTS = 4000;

const weights = {keyboard:.22,pointer:.3,click:.12,scroll:.13,crossModal:.1,rhythm:.13};
const floors = {
  dwell:15,dwellSpread:8,downDown:35,upDown:35,pauseRatio:.1,pauseMedian:150,pauseSpread:120,burstLength:2,correctionRatio:.08,modifierRatio:.08,
  velocity:.06,acceleration:.8,jerk:40,turn:.2,curvature:6,efficiency:.1,segmentDuration:120,segmentLength:.08,segmentRate:.08,
  hold:35,drift:.006,interval:250,settle:90,
  cadence:25,speed:.05,burstDuration:180,reversalRatio:.1,wheelMagnitude:35,
  keyToPointer:200,pointerToKey:250,viewDwell:900,scrollToClick:250,
  dutyCycle:.1,actionRate:1.5,idleMedian:700,focusLoss:.15,burstGap:25,
};
const actions = ['character','correction','modifier','navigation'];

function entropy(values){
  if(!values.length)return null;
  const bins=new Map();for(const v of values){const bin=Math.floor(v/10);bins.set(bin,(bins.get(bin)??0)+1);}
  return -[...bins.values()].reduce((sum,n)=>sum+n/values.length*Math.log2(n/values.length),0);
}
const availabilityOf=quality=>Object.fromEntries(Object.entries(quality).map(([m,q])=>[m,q>0?'AVAILABLE':'UNAVAILABLE']));

export function validateAmbientEvents(events){
  if(!Array.isArray(events)||events.length>AMBIENT_MAX_EVENTS)throw Error('INVALID_EVENTS');
  let last=-1;
  return events.map(e=>{
    if(!e||typeof e!=='object'||Array.isArray(e))throw Error('INVALID_EVENT');
    if(!Number.isFinite(e.t)||e.t<last||e.t<0||e.t>120000)throw Error('INVALID_TIMELINE');last=e.t;
    const allowed=['type','t','trusted'];
    if(e.trusted!==undefined&&typeof e.trusted!=='boolean')throw Error('INVALID_EVENT');
    if(['keydown','keyup'].includes(e.type)){
      allowed.push('position','action');
      if(!Number.isInteger(e.position)||e.position<0||e.position>AMBIENT_MAX_EVENTS||!actions.includes(e.action))throw Error('INVALID_KEY_SEQUENCE');
    }else if(['move','down','up'].includes(e.type)){
      allowed.push('x','y','pointerType');
      if(![e.x,e.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('INVALID_COORDINATES');
      if(e.pointerType!==undefined&&!['mouse','touch','pen'].includes(e.pointerType))throw Error('INVALID_POINTER_TYPE');
    }else if(e.type==='scroll'){
      allowed.push('position');if(!Number.isFinite(e.position)||e.position<0||e.position>1)throw Error('INVALID_SCROLL');
    }else if(e.type==='wheel'){
      allowed.push('deltaY','deltaMode');if(!Number.isFinite(e.deltaY)||Math.abs(e.deltaY)>1e6||![0,1,2].includes(e.deltaMode))throw Error('INVALID_SCROLL');
    }else if(e.type==='focus'){
      allowed.push('active');if(typeof e.active!=='boolean')throw Error('INVALID_FOCUS');
    }else if(e.type==='view'){
      allowed.push('view');if(typeof e.view!=='string'||!/^[a-zA-Z0-9_-]{1,32}$/.test(e.view))throw Error('INVALID_VIEW');
    }else throw Error('INVALID_EVENT_TYPE');
    if(Object.keys(e).some(k=>!allowed.includes(k)))throw Error('CONTENT_DATA_FORBIDDEN');
    return Object.fromEntries(allowed.filter(k=>e[k]!==undefined).map(k=>[k,e[k]]));
  });
}

export function analyzeAmbient(input,hints={}){
  if(!hints||typeof hints!=='object'||Array.isArray(hints)||(hints.webdriver!==undefined&&typeof hints.webdriver!=='boolean'))throw Error('INVALID_HINTS');
  const events=validateAmbientEvents(input);
  if(events.length<4)throw Error('INSUFFICIENT_AMBIENT_EVENTS');
  const held=new Map(),seen=new Set(),keys=[],clicks=[],signals=[];
  let press=null,interrupted=false;
  for(const e of events){
    if(e.type==='keydown'){if(seen.has(e.position))throw Error('INVALID_KEY_SEQUENCE');seen.add(e.position);held.set(e.position,e);}
    else if(e.type==='keyup'){const d=held.get(e.position);if(!d||d.action!==e.action)throw Error('INVALID_KEY_SEQUENCE');held.delete(e.position);keys.push({down:d.t,up:e.t,action:d.action});}
    else if(e.type==='down'){if(press)throw Error('INVALID_POINTER_SEQUENCE');press=e;}
    else if(e.type==='up'){if(!press)throw Error('INVALID_POINTER_SEQUENCE');clicks.push({down:press.t,up:e.t,dx:e.x-press.x,dy:e.y-press.y});press=null;}
    else if(e.type==='focus'&&!e.active)interrupted=true;
  }
  keys.sort((a,b)=>a.down-b.down);
  const span=events.at(-1).t-events[0].t;
  const allGaps=events.slice(1).map((e,i)=>e.t-events[i].t).filter(v=>v>0);
  const stats={},quality={};

  const chars=keys.filter(k=>k.action==='character');
  const dwell=chars.map(k=>k.up-k.down),dd=chars.slice(1).map((k,i)=>k.down-chars[i].down),ud=chars.slice(1).map((k,i)=>k.down-chars[i].up);
  const pauses=dd.filter(v=>v>500),bursts=[];let burst=chars.length?1:0;
  for(const gap of dd){if(gap>500){bursts.push(burst);burst=1;}else burst++;}
  if(burst)bursts.push(burst);
  stats.keyboard={dwell:median(dwell),dwellSpread:dwell.length>2?mad(dwell):null,downDown:median(dd.filter(v=>v<=500)),upDown:median(ud.filter(v=>v<=500)),pauseRatio:dd.length?pauses.length/dd.length:null,pauseMedian:median(pauses),pauseSpread:pauses.length>2?mad(pauses):null,burstLength:median(bursts),correctionRatio:keys.length?keys.filter(k=>k.action==='correction').length/keys.length:null,modifierRatio:keys.length?keys.filter(k=>k.action==='modifier').length/keys.length:null};
  quality.keyboard=Math.min(1,chars.length/25);

  const moves=events.filter(e=>e.type==='move');
  const segments=[];let current=[];
  for(const e of moves){if(current.length&&e.t-current.at(-1).t>250){if(current.length>2)segments.push(current);current=[];}current.push(e);}
  if(current.length>2)segments.push(current);
  const velocity=[],acceleration=[],jerk=[],turn=[],curvature=[],efficiency=[],segmentDuration=[],segmentLength=[],moveGaps=[];
  for(const p of segments){
    const start=p[0],end=p.at(-1),chord=Math.max(.02,Math.hypot(end.x-start.x,end.y-start.y));
    let distance=0,previousV=null,previousA=null;
    for(let i=1;i<p.length;i++){
      const a=p[i-1],b=p[i],dt=b.t-a.t,d=Math.hypot(b.x-a.x,b.y-a.y);distance+=d;
      if(dt>0){moveGaps.push(dt);const v=1000*d/dt;velocity.push(v);
        if(previousV!==null){const acc=(v-previousV)*1000/Math.max(8,dt);acceleration.push(Math.abs(acc));if(previousA!==null)jerk.push(Math.abs((acc-previousA)*1000/Math.max(8,dt)));previousA=acc;}
        previousV=v;}
      if(i>1){const q=p[i-2],angle=Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(a.y-q.y,a.x-q.x),theta=Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)));turn.push(theta);if(d>.001)curvature.push(theta/d);}
    }
    efficiency.push(Math.min(1,chord/Math.max(chord,distance)));segmentDuration.push(end.t-start.t);segmentLength.push(distance);
  }
  stats.pointer={velocity:median(velocity),acceleration:median(acceleration),jerk:median(jerk),turn:median(turn),curvature:median(curvature),efficiency:median(efficiency),segmentDuration:median(segmentDuration),segmentLength:median(segmentLength),segmentRate:span?1000*segments.length/span:null};
  quality.pointer=Math.min(1,velocity.length/40,segments.length/3);

  const intervals=clicks.slice(1).map((c,i)=>c.down-clicks[i].down);
  const settle=clicks.flatMap(c=>{const before=moves.filter(e=>e.t<=c.down);return before.length?[c.down-before.at(-1).t]:[];}).filter(v=>v>=0&&v<4000);
  stats.click={hold:median(clicks.map(c=>c.up-c.down)),drift:median(clicks.map(c=>Math.hypot(c.dx,c.dy))),interval:median(intervals.filter(v=>v<10000)),settle:median(settle)};
  quality.click=Math.min(1,clicks.length/4);

  const scrolls=events.filter(e=>e.type==='scroll'),wheels=events.filter(e=>e.type==='wheel');
  const scrollGaps=scrolls.slice(1).map((e,i)=>e.t-scrolls[i].t).filter(v=>v>0);
  const deltas=scrolls.slice(1).map((e,i)=>e.position-scrolls[i].position);
  const reversals=deltas.slice(1).filter((d,i)=>d*deltas[i]<0).length;
  const scrollBursts=[];let runStart=null,runLast=null;
  for(const e of scrolls){if(runLast!==null&&e.t-runLast>400){if(runLast>runStart)scrollBursts.push(runLast-runStart);runStart=e.t;}if(runStart===null)runStart=e.t;runLast=e.t;}
  if(runStart!==null&&runLast>runStart)scrollBursts.push(runLast-runStart);
  stats.scroll={cadence:median(scrollGaps),speed:median(scrolls.slice(1).flatMap((e,i)=>e.t>scrolls[i].t?[Math.abs(e.position-scrolls[i].position)*1000/(e.t-scrolls[i].t)]:[])),burstDuration:median(scrollBursts),reversalRatio:deltas.length>1?reversals/(deltas.length-1):null,wheelMagnitude:median(wheels.map(e=>Math.abs(e.deltaY)))};
  quality.scroll=Math.min(1,scrolls.length/12);

  const keyToPointer=chars.flatMap(k=>{const m=moves.find(e=>e.t>=k.up);return m&&m.t-k.up<4000?[m.t-k.up]:[];});
  const pointerToKey=clicks.flatMap(c=>{const k=chars.find(x=>x.down>=c.up);return k&&k.down-c.up<4000?[k.down-c.up]:[];});
  const views=events.filter(e=>e.type==='view');
  stats.crossModal={keyToPointer:median(keyToPointer),pointerToKey:median(pointerToKey),viewDwell:median(views.slice(1).map((e,i)=>e.t-views[i].t)),scrollToClick:median(clicks.flatMap(c=>{const s=scrolls.filter(e=>e.t<=c.down).at(-1);return s&&c.down-s.t<4000?[c.down-s.t]:[];}))};
  quality.crossModal=Object.values(stats.crossModal).filter(Number.isFinite).length/4;

  const idleGaps=allGaps.filter(v=>v>1000);
  stats.rhythm={dutyCycle:span?Math.max(0,1-idleGaps.reduce((a,b)=>a+b,0)/span):null,actionRate:span?1000*events.length/span:null,idleMedian:median(idleGaps),focusLoss:span?1000*events.filter(e=>e.type==='focus'&&!e.active).length/span:null,burstGap:median(allGaps.filter(v=>v<=1000))};
  quality.rhythm=Math.min(1,span/8000,events.length/60);

  if(events.some(e=>e.trusted===false))signals.push({code:'SYNTHETIC_EVENT_HINT',penalty:.3});
  if(hints.webdriver===true)signals.push({code:'WEBDRIVER_HINT',penalty:.05});
  if(moveGaps.length>=40&&mad(moveGaps)<.05)signals.push({code:'PERIODIC_POINTER_SAMPLING',penalty:.1});
  if(velocity.length>=40&&stats.pointer.efficiency>.9999&&stats.pointer.turn<.001)signals.push({code:'PERFECT_POINTER_GEOMETRY',penalty:.15});
  if(dd.length>=12&&mad(dd)<1)signals.push({code:'UNIFORM_KEY_TIMING',penalty:.2});
  else if(dd.length>=12&&entropy(dd)<.6)signals.push({code:'LOW_ENTROPY_KEY_TIMING',penalty:.15});
  if(chars.length>=8&&(median(dwell)<8||median(dd)<20))signals.push({code:'IMPLAUSIBLE_KEY_TIMING',penalty:.35});
  if(clicks.length>=4&&mad(clicks.map(c=>c.up-c.down))<1&&median(clicks.map(c=>Math.hypot(c.dx,c.dy)))===0)signals.push({code:'UNIFORM_CLICK_BEHAVIOR',penalty:.15});

  const Q=Object.entries(weights).reduce((s,[m,w])=>s+w*(quality[m]??0),0)*(interrupted?.7:1);
  const humanScore=Math.max(0,.95-signals.reduce((s,x)=>s+x.penalty,0));
  const origin=events[0].t,scale=Math.max(1,median(allGaps)??1),rich=events.length>=24;
  return {
    featureSchemaVersion:AMBIENT_SCHEMA_VERSION,matcherVersion:AMBIENT_VERSION,stats,evidenceQuality:quality,quality:Q,humanScore,
    hardAutomation:signals.length>=2&&humanScore<.45,signals:signals.map(s=>s.code),availability:availabilityOf(quality),
    span,eventCount:events.length,complete:held.size===0&&!press,interrupted,
    signature:rich?createHash('sha256').update(JSON.stringify(events.map(({trusted,...e})=>({...e,t:e.t-origin})))).digest('hex'):null,
    fingerprint:rich?{types:events.map(e=>[e.type,e.action??'',e.view??''].join(':')).join('|'),deltas:allGaps.map(d=>d/scale),path:moves.map(e=>[e.x,e.y])}:null,
    events,
  };
}

export function ambientNearReplay(a,b){
  if(!a||!b||a.types!==b.types||a.deltas.length<30||a.deltas.length!==b.deltas.length||a.path.length!==b.path.length)return false;
  return a.deltas.every((d,i)=>Math.abs(d-b.deltas[i])<.04)
    &&a.deltas.reduce((s,d,i)=>s+Math.abs(d-b.deltas[i]),0)/a.deltas.length<.012
    &&a.path.every((p,i)=>Math.hypot(p[0]-b.path[i][0],p[1]-b.path[i][1])<.008);
}

export function aggregateAmbient(derived){
  const usableWindows=derived.filter(d=>d&&d.stats);
  if(!usableWindows.length)return null;
  const stats={},quality={};
  for(const modality of Object.keys(weights)){
    stats[modality]={};
    const usable=usableWindows.filter(d=>(d.evidenceQuality?.[modality]??0)>0);
    for(const name of new Set(usable.flatMap(d=>Object.keys(d.stats[modality]??{})))){
      const values=usable.map(d=>d.stats[modality]?.[name]).filter(Number.isFinite);
      if(values.length)stats[modality][name]=median(values);
    }
    quality[modality]=Math.min(1,usable.reduce((s,d)=>s+d.evidenceQuality[modality],0)/2);
  }
  return {featureSchemaVersion:AMBIENT_SCHEMA_VERSION,matcherVersion:AMBIENT_VERSION,stats,evidenceQuality:quality,
    quality:Object.entries(weights).reduce((s,[m,w])=>s+w*quality[m],0),
    humanScore:Math.min(...usableWindows.map(d=>d.humanScore)),
    hardAutomation:usableWindows.some(d=>d.hardAutomation),
    signals:[...new Set(usableWindows.flatMap(d=>d.signals??[]))],
    availability:availabilityOf(quality),windows:usableWindows.length,
    span:usableWindows.reduce((s,d)=>s+(d.span??0),0),eventCount:usableWindows.reduce((s,d)=>s+(d.eventCount??0),0)};
}

export function ambientModel(samples){
  const model={};
  for(const modality of Object.keys(weights)){
    model[modality]={};
    const names=new Set(samples.flatMap(s=>Object.keys(s.stats?.[modality]??{})));
    for(const name of names){
      const values=samples.filter(s=>(s.evidenceQuality?.[modality]??0)>0).map(s=>s.stats[modality]?.[name]).filter(Number.isFinite);
      if(values.length<3)continue;
      const floor=floors[name]??30,scale=Math.max(floor,1.4826*mad(values));
      model[modality][name]={center:median(values),scale,weight:Math.max(.25,Math.min(1,floor/scale))};
    }
  }
  return model;
}

export function matchAmbient(a,profile){
  const modalities={};
  for(const m of Object.keys(weights)){
    modalities[m]=(a?.evidenceQuality?.[m]??0)>0
      ? fuse(Object.entries(profile?.model?.[m]??{}).map(([name,p])=>({score:Number.isFinite(a.stats[m]?.[name])?Math.exp(-.5*Math.min(4,Math.abs(a.stats[m][name]-p.center)/p.scale)**2):null,weight:p.weight})))
      : null;
  }
  const modelQuality=Object.entries(weights).reduce((s,[m,w])=>s+(Number.isFinite(modalities[m])?w*a.evidenceQuality[m]:0),0);
  return {score:fuse(Object.entries(weights).map(([m,w])=>({score:modalities[m],weight:w*(a?.evidenceQuality?.[m]??0)}))),modalities,quality:Math.min(a?.quality??0,modelQuality)};
}

export function calibrateAmbient(samples){
  const scores=samples.map((s,i)=>matchAmbient(s,{model:ambientModel(samples.filter((_,j)=>i!==j))}).score).filter(Number.isFinite);
  return {model:ambientModel(samples),
    threshold:Math.max(.6,Math.min(.92,(median(scores)??.6)-3*(mad(scores)??0))),
    qualityMinimum:.35,humanMinimum:.7,windows:samples.length,
    featureSchemaVersion:AMBIENT_SCHEMA_VERSION,matcherVersion:AMBIENT_VERSION,
    calibration:{method:'leave-one-window-out',scores,provisional:true}};
}
