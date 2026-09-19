import { createHash } from 'node:crypto';
import { median, mad } from './features/index.js';
import { fuse } from './matching/index.js';

export const PASSIVE_VERSION = 'passive-4';
export const PASSIVE_SCHEMA_VERSION = 4;
export const PASSIVE_ROUNDS = 10;
export const PASSIVE_ROUNDS_MINIMUM = 8;
export const PASSIVE_ROUNDS_MAXIMUM = PASSIVE_ROUNDS + 6;
export const PASSIVE_WEIGHTS = { username:.2, password:.3, pointer:.25, click:.1, crossModal:.15 };
export const PASSIVE_ACCEPT_RULE = { percentile:.1, floor:.4, ceiling:.9 };
export const PASSIVE_REJECT_RULE = { fraction:.4, margin:.1 };
export const percentile=(values,f)=>{const s=(values??[]).filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s[Math.floor(f*(s.length-1))]:null;};
export function passiveThresholds(scores,accept=PASSIVE_ACCEPT_RULE,reject=PASSIVE_REJECT_RULE){
  const raw=percentile(scores,accept.percentile);
  const threshold=raw===null?accept.ceiling:Math.max(accept.floor,Math.min(accept.ceiling,raw));
  const rejectThreshold=Math.max(0,Math.min(threshold-reject.margin,raw===null?0:reject.fraction*raw));
  return {threshold,rejectThreshold,rawThreshold:raw};
}
const weights = PASSIVE_WEIGHTS;
const floors = { dwell:15, flight:30, overlap:.1, correction:.08, pauseRatio:.1, velocity:.5, entryVelocity:.5, correctionRatio:.1, acceleration:10, efficiency:.1, turn:.2, hold:35, arrival:80, x:.15, y:.15, fieldTransition:200, keyToPointer:180, approach:150 };
const fields = ['username','password'];
const targets = ['username','password','submit','form'];
Object.assign(floors,{upDown:30,pauseMedian:100,pauseSpread:100,burstLength:2,modifierRatio:.08,shiftRatio:.08,transitionTab:.25,transitionClick:.25,overshoot:.1,approachAngle:.25,curvature:1});
function entropy(values){
  if(!values.length)return null;
  const bins=new Map();for(const v of values){const bin=Math.floor(v/10);bins.set(bin,(bins.get(bin)??0)+1);}
  return -[...bins.values()].reduce((sum,n)=>sum+n/values.length*Math.log2(n/values.length),0);
}

export function validatePassiveEvents(events) {
  if (!Array.isArray(events) || events.length > 12000) throw Error('INVALID_EVENTS');
  let last=-1;
  return events.map(e=>{
    if(!e || !Number.isFinite(e.t) || e.t<last || e.t<0 || e.t>180000)throw Error('INVALID_TIMELINE');last=e.t;
    const allowed=['type','t','trusted'];
    if(e.trusted!==undefined&&typeof e.trusted!=='boolean')throw Error('INVALID_EVENT');
    if(['keydown','keyup'].includes(e.type)) {
      allowed.push('field','position','action');
      if(!fields.includes(e.field)||!Number.isInteger(e.position)||e.position<0||e.position>4000||!['character','correction','modifier','navigation'].includes(e.action))throw Error('INVALID_KEY_SEQUENCE');
      if(e.field==='username'){allowed.push('key','code');if(typeof e.key!=='string'||e.key.length>32||(e.code!==undefined&&typeof e.code!=='string'))throw Error('INVALID_KEY_SEQUENCE');}
    } else if(['move','down','up'].includes(e.type)) {
      allowed.push('x','y','target','pointerType','buttonX','buttonY');
      if(!targets.includes(e.target)||![e.x,e.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('INVALID_COORDINATES');
      if(e.pointerType!==undefined&&!['mouse','touch','pen'].includes(e.pointerType))throw Error('INVALID_POINTER_TYPE');
      for(const key of ['buttonX','buttonY'])if(e[key]!==undefined&&(!Number.isFinite(e[key])||e[key]<0||e[key]>1))throw Error('INVALID_COORDINATES');
    } else if(e.type==='focus') {
      allowed.push('field','active');if(![...fields,'form'].includes(e.field)||typeof e.active!=='boolean')throw Error('INVALID_FOCUS');
    } else if(e.type==='input') {
      allowed.push('field','source');if(!fields.includes(e.field)||!['typing','autofill','composition'].includes(e.source))throw Error('INVALID_INPUT_METADATA');
    } else if(e.type==='submit') {
      allowed.push('method');if(!['pointer','keyboard'].includes(e.method))throw Error('INVALID_SUBMIT');
    } else if(e.type==='cancel') {
    } else throw Error('INVALID_EVENT_TYPE');
    if(Object.keys(e).some(key=>!allowed.includes(key)))throw Error(e.field==='password'?'PASSWORD_DATA_FORBIDDEN':'INVALID_EVENT_FIELD');
    return Object.fromEntries(allowed.filter(key=>e[key]!==undefined).map(key=>[key,e[key]]));
  });
}

export function analyzePassive(input,hints={}) {
  if(!hints||typeof hints!=='object'||Array.isArray(hints)||(hints.webdriver!==undefined&&typeof hints.webdriver!=='boolean'))throw Error('INVALID_HINTS');
  const events=validatePassiveEvents(input),held=new Map(),seen=new Set(),keys={username:[],password:[]};
  let press=null,click=null,submit=null;
  for(const e of events){
    if(submit)throw Error('EVENT_AFTER_SUBMIT');
    if(e.type==='keydown'){
      const id=e.field+':'+e.position;if(seen.has(id))throw Error('INVALID_KEY_SEQUENCE');seen.add(id);held.set(id,e);
    }else if(e.type==='keyup'){
      const id=e.field+':'+e.position,d=held.get(id);
      if(!d||d.action!==e.action||(e.field==='username'&&d.key!==e.key))throw Error('INVALID_KEY_SEQUENCE');
      held.delete(id);keys[e.field].push({down:d.t,up:e.t,action:d.action,...(e.field==='username'?{key:d.key}:{})});
    }else if(e.type==='down'){if(press)throw Error('INVALID_POINTER_SEQUENCE');press=e;}
    else if(e.type==='up'){if(!press)throw Error('INVALID_POINTER_SEQUENCE');if(e.target==='submit'&&press.target==='submit')click={down:press,up:e};press=null;}
    else if(e.type==='cancel'){press=null;}
    else if(e.type==='submit'){if(e.method==='pointer'&&!click)throw Error('INVALID_SUBMIT');submit=e;}
  }
  if(!submit)throw Error('MISSING_SUBMIT');
  const stats={},quality={},signals=[];
  for(const field of fields){
    const all=keys[field].sort((a,b)=>a.down-b.down),k=all.filter(e=>e.action==='character');
    const dwell=k.map(e=>e.up-e.down),flight=k.slice(1).map((e,i)=>e.down-k[i].down),overlap=k.slice(1).map((e,i)=>e.down<k[i].up?1:0);
    stats[field]={dwell:median(dwell),flight:median(flight),overlap:overlap.length?overlap.reduce((a,b)=>a+b,0)/overlap.length:null,correction:all.length?all.filter(e=>e.action==='correction').length/all.length:null,pauseRatio:flight.length?flight.filter(v=>v>500).length/flight.length:null};
    const pauses=flight.filter(v=>v>500),bursts=[];let burst=k.length?1:0;
    for(const gap of flight){if(gap>500){bursts.push(burst);burst=1;}else burst++;}if(burst)bursts.push(burst);
    Object.assign(stats[field],{upDown:median(k.slice(1).map((e,i)=>e.down-k[i].up)),pauseMedian:median(pauses),pauseSpread:pauses.length?mad(pauses):null,burstLength:median(bursts),modifierRatio:all.length?all.filter(e=>e.action==='modifier').length/all.length:null});
    if(field==='password'){
      let cursor=0;const slots=[];
      for(const e of all){if(e.action==='character'){slots.push({...e,slot:cursor});cursor++;}else if(e.action==='correction')cursor=Math.max(0,cursor-1);}
      const bySlot=new Map();for(const e of slots)bySlot.set(e.slot,e);
      for(const [slot,e] of bySlot)if(slot<40)stats[field]['pos:'+slot+':dwell']=e.up-e.down;
      for(let i=1;i<slots.length;i++)if(slots[i].slot===slots[i-1].slot+1&&slots[i].slot<40)stats[field]['pos:'+slots[i-1].slot+'-'+slots[i].slot+':dd']=slots[i].down-slots[i-1].down;
    }
    if(field==='username'){
      stats[field].shiftRatio=all.length?all.filter(e=>e.key==='Shift').length/all.length:null;
      const contexts=new Map();
      const addContext=(name,value)=>{if(!contexts.has(name))contexts.set(name,[]);contexts.get(name).push(value);};
      for(let i=0;i<k.length;i++){addContext('key:'+k[i].key+':dwell',k[i].up-k[i].down);if(i>0)addContext('digraph:'+k[i-1].key+k[i].key,k[i].down-k[i-1].down);}
      for(const [name,values] of contexts)stats[field][name]=median(values);
    }
    quality[field]=Math.min(1,k.length/(field==='username'?8:12));
    if(events.some(e=>e.type==='input'&&e.field===field&&e.source!=='typing'))quality[field]=0;
    if(flight.length>=8&&mad(flight)<1)signals.push({code:'UNIFORM_'+field.toUpperCase()+'_TIMING',penalty:.15});
    else if(flight.length>=12&&entropy(flight)<.6)signals.push({code:'LOW_ENTROPY_'+field.toUpperCase()+'_TIMING',penalty:.15});
    if(k.length>=6&&(median(dwell)<8||median(flight)<20))signals.push({code:'IMPLAUSIBLE_'+field.toUpperCase()+'_TIMING',penalty:.3});
  }
  const passwordKeys=quality.password>0?keys.password.filter(e=>e.action==='character'):[],usernameKeys=quality.username>0?keys.username.filter(e=>e.action==='character'):[];
  const lastPassword=passwordKeys.length?Math.max(...passwordKeys.map(e=>e.up)):null;
  const lastUsername=usernameKeys.length?Math.max(...usernameKeys.map(e=>e.up)):null;
  const firstPassword=passwordKeys.length?Math.min(...passwordKeys.map(e=>e.down)):null;
  const moves=events.filter(e=>e.type==='move'&&(lastPassword===null||e.t>=lastPassword)&&(!click||e.t<=click.down.t));
  const speed=[],acceleration=[],turn=[],gaps=[],curvature=[];let distance=0,entryVelocity=null,away=0;
  const chord=moves.length>1?Math.hypot(moves.at(-1).x-moves[0].x,moves.at(-1).y-moves[0].y):0;
  for(let i=1;i<moves.length;i++){
    const a=moves[i-1],b=moves[i],dt=b.t-a.t,d=Math.hypot(b.x-a.x,b.y-a.y);distance+=d;
    if(click&&Math.hypot(b.x-click.down.x,b.y-click.down.y)>Math.hypot(a.x-click.down.x,a.y-click.down.y))away+=d;
    if(dt>0){gaps.push(dt);const v=1000*d/dt/Math.max(.05,chord);if(speed.length)acceleration.push(Math.abs(v-speed.at(-1))*1000/Math.max(8,dt));speed.push(v);if(b.target==='submit'&&entryVelocity===null)entryVelocity=v;}
    if(i>1){const p=moves[i-2],angle=Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(a.y-p.y,a.x-p.x),theta=Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)));turn.push(theta);if(d>.001)curvature.push(theta/d);}
  }
  const duration=moves.length>1?moves.at(-1).t-moves[0].t:0;
  const arrival=moves.find(e=>e.target==='submit');
  stats.pointer={velocity:median(speed),entryVelocity,acceleration:median(acceleration),efficiency:distance?Math.min(1,chord/distance):null,turn:median(turn),correctionRatio:turn.length?turn.filter(v=>v>.35).length/turn.length:null};
  const entry=arrival?moves.indexOf(arrival):-1;
  const previous=entry>0?moves[entry-1]:null;
  Object.assign(stats.pointer,{curvature:median(curvature),overshoot:distance?away/distance:null,approachAngle:previous&&click?Math.abs(Math.atan2(Math.sin(Math.atan2(arrival.y-previous.y,arrival.x-previous.x)-Math.atan2(click.down.y-previous.y,click.down.x-previous.x)),Math.cos(Math.atan2(arrival.y-previous.y,arrival.x-previous.x)-Math.atan2(click.down.y-previous.y,click.down.x-previous.x)))):null});
  quality.pointer=Math.min(1,moves.length/30,duration/250,distance/.12);
  stats.click={hold:click?click.up.t-click.down.t:null,arrival:click&&arrival?Math.max(0,click.down.t-arrival.t):null,x:click?.up.buttonX??null,y:click?.up.buttonY??null};
  quality.click=click?1:0;
  stats.crossModal={fieldTransition:firstPassword!==null&&lastUsername!==null&&firstPassword>=lastUsername?firstPassword-lastUsername:null,keyToPointer:lastPassword!==null&&moves.length?moves[0].t-lastPassword:null,approach:moves.length&&arrival?arrival.t-moves[0].t:null};
  quality.crossModal=Object.values(stats.crossModal).filter(Number.isFinite).length/3;
  if(firstPassword!==null&&lastUsername!==null){
    const transition=events.filter(e=>e.t>=lastUsername&&e.t<=firstPassword);
    stats.crossModal.transitionTab=transition.some(e=>e.type==='keydown'&&e.field==='username'&&e.key==='Tab')?1:0;
    stats.crossModal.transitionClick=transition.some(e=>e.type==='down'&&e.target==='password')?1:stats.crossModal.transitionTab?0:null;
    if(firstPassword-lastUsername>=0&&firstPassword-lastUsername<5&&stats.crossModal.keyToPointer!==null&&stats.crossModal.keyToPointer<5)signals.push({code:'IMPLAUSIBLE_CROSS_MODAL_TIMING',penalty:.15});
  }
  const physical=events.filter(e=>['keydown','keyup','move','down','up'].includes(e.type));
  if(physical.length>=8&&physical.every(e=>e.trusted===false))signals.push({code:'ALL_EVENTS_UNTRUSTED',penalty:.6});
  else if(events.some(e=>e.trusted===false))signals.push({code:'SYNTHETIC_EVENT_HINT',penalty:.25});
  if(hints.webdriver===true)signals.push({code:'WEBDRIVER_HINT',penalty:.05});
  if(gaps.length>=25&&mad(gaps)<.1)signals.push({code:'PERIODIC_POINTER_SAMPLING',penalty:.1});
  if(moves.length>=25&&stats.pointer.efficiency>.9999&&stats.pointer.turn<.001)signals.push({code:'PERFECT_POINTER_GEOMETRY',penalty:.05});
  if(signals.some(s=>s.code==='PERIODIC_POINTER_SAMPLING')&&signals.some(s=>s.code==='PERFECT_POINTER_GEOMETRY'))signals.push({code:'SYNTHETIC_POINTER_PATH',penalty:.4});
  const keyboardSubmit=submit.method==='keyboard';
  const expected=Object.keys(weights).filter(m=>!keyboardSubmit||!['pointer','click'].includes(m));
  const expectedWeight=expected.reduce((sum,m)=>sum+weights[m],0);
  if(keyboardSubmit)quality.crossModal=Number.isFinite(stats.crossModal.fieldTransition)?1:0;
  const interrupted=events.some(e=>e.type==='cancel'||e.type==='focus'&&e.field==='form'&&!e.active);
  const complete=[...held.values()].every(e=>submit.method==='keyboard'&&e.action==='navigation')&&!press;
  const Q=expected.reduce((sum,m)=>sum+weights[m]*quality[m],0)/expectedWeight*(complete&&!interrupted?1:.5);
  const humanScore=Math.max(0,.95-signals.reduce((sum,s)=>sum+s.penalty,0));
  const codes=signals.map(s=>s.code),has=c=>codes.includes(c);
  const hardSignals=codes.filter(c=>c==='ALL_EVENTS_UNTRUSTED'||c==='SYNTHETIC_POINTER_PATH'||c.startsWith('IMPLAUSIBLE_')&&c.endsWith('_TIMING')&&c!=='IMPLAUSIBLE_CROSS_MODAL_TIMING'||c.startsWith('UNIFORM_')&&has('UNIFORM_USERNAME_TIMING')&&has('UNIFORM_PASSWORD_TIMING'));
  const hardAutomation=hardSignals.length>0||signals.length>=2&&humanScore<.45;
  const richEnough=seen.size>=8||moves.length>=20;
  const origin=events[0]?.t??0;
  const canonical=events.map(({trusted,...e})=>({...e,t:e.t-origin}));
  const deltas=events.slice(1).map((e,i)=>e.t-events[i].t),scale=median(deltas.filter(d=>d>0))??1;
  return {featureSchemaVersion:PASSIVE_SCHEMA_VERSION,matcherVersion:PASSIVE_VERSION,stats,evidenceQuality:quality,quality:Q,complete,humanScore,hardAutomation,hardSignals,signals:codes,submitMethod:submit.method,expected,expectedWeight,availability:Object.fromEntries(Object.entries(quality).map(([m,q])=>[m,q?'AVAILABLE':'UNAVAILABLE'])),signature:richEnough?createHash('sha256').update(JSON.stringify(canonical)).digest('hex'):null,fingerprint:richEnough?{types:events.map(e=>[e.type,e.field??e.target??'',e.action??'',e.key??''].join(':')).join('|'),deltas:deltas.map(d=>d/Math.max(1,scale)),path:moves.map(e=>[e.x,e.y])}:null,events};
}

export function passiveNearReplay(a,b){
  if(!a||!b||a.types!==b.types||a.deltas.length<35||a.deltas.length!==b.deltas.length||a.path.length!==b.path.length)return false;
  return a.deltas.every((d,i)=>Math.abs(d-b.deltas[i])<.04)&&a.deltas.reduce((s,d,i)=>s+Math.abs(d-b.deltas[i]),0)/a.deltas.length<.01&&a.path.every((p,i)=>Math.hypot(p[0]-b.path[i][0],p[1]-b.path[i][1])<.008);
}

export function passiveModel(samples){
  const model={};
  for(const modality of Object.keys(weights)){
    model[modality]={};const names=new Set(samples.flatMap(s=>Object.keys(s.stats[modality]??{})));
    for(const name of names){const values=samples.filter(s=>s.evidenceQuality[modality]>0).map(s=>s.stats[modality]?.[name]).filter(Number.isFinite);if(values.length<3)continue;const floor=floors[name]??(name.endsWith(':dwell')?floors.dwell:30),scale=Math.max(floor,1.4826*mad(values));model[modality][name]={center:median(values),scale,weight:Math.max(.25,Math.min(1,floor/scale))};}
  }
  return model;
}
export function matchPassive(a,profile){
  const modalities={},features={};
  for(const m of Object.keys(weights)){
    features[m]=Object.entries(profile?.model?.[m]??{}).map(([name,p])=>{
      const value=Number.isFinite(a.stats[m]?.[name])?a.stats[m][name]:null;
      const z=value===null?null:Math.abs(value-p.center)/p.scale;
      return {name,value,center:p.center,scale:p.scale,weight:p.weight,z,
        score:z===null?null:Math.exp(-.5*Math.min(4,z)**2)};
    });
    modalities[m]=a.evidenceQuality[m]>0?fuse(features[m].map(f=>({score:f.score,weight:f.weight}))):null;
  }
  const modelQuality=Object.entries(weights).reduce((s,[m,w])=>s+(Number.isFinite(modalities[m])?w*a.evidenceQuality[m]:0),0)/(a.expectedWeight??1);
  return {score:fuse(Object.entries(weights).map(([m,w])=>({score:modalities[m],weight:w*a.evidenceQuality[m]}))),modalities,features,quality:Math.min(a.quality,modelQuality)};
}
export function passiveConsistent(calibration,rounds){
  const scores=calibration?.calibration?.scores??[];
  if(rounds<PASSIVE_ROUNDS_MINIMUM||scores.length<rounds)return false;
  return percentile(scores,.1)>=.45&&(median(scores)??0)>=.6;
}
export function calibratePassive(samples){
  const loo=samples.map((s,i)=>matchPassive(s,{model:passiveModel(samples.filter((_,j)=>i!==j))}));
  const scores=loo.map(m=>m.score).filter(Number.isFinite);
  const modalities=Object.fromEntries(Object.keys(weights).map(m=>{const v=loo.map(x=>x.modalities[m]).filter(Number.isFinite);return [m,v.length?{scores:v,median:median(v),mad:mad(v),threshold:passiveThresholds(v).threshold}:null];}));
  return {model:passiveModel(samples),...passiveThresholds(scores),qualityMinimum:.75,humanMinimum:.8,rounds:samples.length,featureSchemaVersion:PASSIVE_SCHEMA_VERSION,matcherVersion:PASSIVE_VERSION,
    calibration:{method:'leave-one-round-out',rule:`accept=clamp(p${PASSIVE_ACCEPT_RULE.percentile*100}(LOO),${PASSIVE_ACCEPT_RULE.floor},${PASSIVE_ACCEPT_RULE.ceiling}); reject=min(${PASSIVE_REJECT_RULE.fraction}*p${PASSIVE_ACCEPT_RULE.percentile*100}(LOO),accept-${PASSIVE_REJECT_RULE.margin})`,scores,modalities,provisional:true}};
}
export function passiveBars(profile){
  if(!profile)return {threshold:PASSIVE_ACCEPT_RULE.ceiling,rejectThreshold:0,modalityThresholds:{}};
  const current=profile.matcherVersion===PASSIVE_VERSION&&Number.isFinite(profile.rejectThreshold);
  const bars=current?{threshold:profile.threshold,rejectThreshold:profile.rejectThreshold}:passiveThresholds(profile.calibration?.scores);
  const modalityThresholds=Object.fromEntries(Object.entries(profile.calibration?.modalities??{}).flatMap(([m,c])=>c&&Number.isFinite(c.threshold)?[[m,c.threshold]]:[]));
  return {...bars,modalityThresholds};
}
