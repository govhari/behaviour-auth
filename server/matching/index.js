import { median, mad } from '../features/index.js';
export const MATCHER_VERSION='exemplar-dtw-3';
export const MAX_EXEMPLARS=24;
const floor={dwell:12,dd:25,ud:25,uu:25,overlap:.1,corrections:.05,pauseRatio:.05,velocity:.3,acceleration:8,jerk:500,turn:.2,efficiency:.08,click:30,pressure:.1,width:3,speed:.2,magnitude:1,keyToPointer:200,arrivalToClick:60};
Object.assign(floor,{reaction:100,curvature:1,approachAngle:.25,overshoot:.1,entryVelocity:.3,correctionRatio:.1});
Object.assign(floor,{linearMagnitude:1,rotationMagnitude:15,rotationSpread:10,cadence:30,burstDuration:150,reversalRatio:.1,overshootCount:1,wheelMagnitude:30,pressureSpread:.08,tilt:10,tiltSpread:5,twistSin:.2,twistCos:.2,contactHeight:3});
export function dtw(a,b,window=8){
  if(!a?.length||!b?.length)return null;
  a=a.slice(0,64);b=b.slice(0,64);window=Math.max(window,Math.abs(a.length-b.length));
  let prev=Array(b.length+1).fill(Infinity);prev[0]=0;
  for(let i=1;i<=a.length;i++){const row=Array(b.length+1).fill(Infinity);for(let j=Math.max(1,i-window);j<=Math.min(b.length,i+window);j++){const cost=Math.sqrt(a[i-1].reduce((s,x,k)=>s+(x-b[j-1][k])**2,0)/a[i-1].length);row[j]=cost+Math.min(prev[j],row[j-1],prev[j-1]);}prev=row;}
  return prev[b.length]/Math.max(a.length,b.length);
}
export function fuse(parts){const usable=parts.filter(p=>Number.isFinite(p.score)&&p.weight>0);return usable.length?Math.exp(usable.reduce((s,p)=>s+p.weight*Math.log(Math.max(1e-6,p.score)),0)/usable.reduce((s,p)=>s+p.weight,0)):null;}
export function buildAdvanced(records){
  const stats={};
  for(const modality of ['keyboard','pointer','touch','pen','scroll','motion','crossModal']){stats[modality]={};for(const name of new Set(records.flatMap(r=>Object.keys(r.derived.rich?.stats[modality]??{})))){const values=records.map(r=>r.derived.rich?.stats[modality]?.[name]).filter(Number.isFinite);if(values.length<3)continue;const scale=Math.max(floor[name]??1,1.4826*mad(values));stats[modality][name]={center:median(values),scale,weight:Math.max(.25,Math.min(2,(floor[name]??1)/scale))};}}
  const context={};for(const r of records)for(const [key,values] of Object.entries(r.derived.rich?.context??{}))(context[key]??=[]).push(...values);
  for(const [key,v] of Object.entries(context))context[key]={center:median(v),scale:Math.max(25,1.4826*mad(v)),count:v.length};
  const buckets=new Map();for(const r of records){const k=r.challenge.phrase;(buckets.get(k)??(buckets.set(k,[]),buckets.get(k))).push(r);}
  const exemplars=[];while(exemplars.length<MAX_EXEMPLARS&&[...buckets.values()].some(v=>v.length)){for(const v of buckets.values()){const r=v.pop();if(r&&exemplars.length<MAX_EXEMPLARS)exemplars.push({sessionId:r.sessionId,phrase:r.challenge.phrase,deviceClass:r.challenge.device?.class??'desktop-pointer',rich:r.derived.rich,feature:r.derived.feature});}}
  return {matcherVersion:MATCHER_VERSION,stats,context,exemplars};
}
export function matchAdvanced(a,c,p){
  if(!p||!a.rich)return {score:null,complete:false,modalities:{},exemplarCount:0};
  const modalities={},weights={keyboard:1,pointer:1,touch:.3,pen:.3,scroll:.25,motion:.15,crossModal:.5};
  for(const [mod,fields] of Object.entries(p.stats)){modalities[mod]=fuse(Object.entries(fields).map(([name,m])=>({score:Number.isFinite(a.rich.stats[mod]?.[name])?Math.exp(-.5*Math.min(4,Math.abs(a.rich.stats[mod][name]-m.center)/m.scale)**2):null,weight:m.weight})));}
  const contexts=Object.entries(a.rich.context).flatMap(([k,v])=>p.context[k]?.count>=3?[Math.exp(-.5*Math.min(4,Math.abs(median(v)-p.context[k].center)/p.context[k].scale)**2)]:[]);
  const contextual=contexts.length>=3?median(contexts):null;
  const compatible=p.exemplars.filter(e=>e.phrase===c.phrase&&e.deviceClass===(c.device?.class??'desktop-pointer'));
  const distances=compatible.map(e=>{
    const current=a.rich.sequences,previous=e.rich.sequences;
    const segmentDistance=name=>median((current[name]??[]).slice(0,previous[name]?.length??0).map((seq,i)=>dtw(seq,previous[name][i])).filter(Number.isFinite));
    const parts=[['keyboard',dtw(current.keyboard,previous.keyboard),1],['pointer',segmentDistance('pointer'),1],['curvature',segmentDistance('curvature'),.35],['touch',segmentDistance('touch'),.5],['crossModal',dtw(current.crossModal,previous.crossModal),.35]];
    return fuse(parts.map(([,distance,weight])=>({score:distance===null?null:Math.exp(-distance),weight})));
  }).filter(Number.isFinite).sort((a,b)=>b-a);
  const sequence=distances.length>=3?median(distances.slice(0,3)):null;
  const statistical=fuse(Object.entries(modalities).filter(([k])=>k!=='crossModal').map(([k,score])=>({score,weight:weights[k]*a.rich.quality[k]})));
  const multimodal=fuse(Object.entries(modalities).map(([k,score])=>({score,weight:weights[k]*a.rich.quality[k]})));
  const exemplar=compatible.length>=3?median(compatible.map(e=>{const deltas=a.feature.flatMap((v,i)=>Number.isFinite(v)&&Number.isFinite(e.feature[i])?[((v-e.feature[i])/[30,60,1,60][i])**2]:[]);return deltas.length?Math.exp(-Math.sqrt(deltas.reduce((a,b)=>a+b,0)/deltas.length)):null;}).filter(Number.isFinite).sort((a,b)=>b-a).slice(0,3)):null;
  return {score:fuse([{score:multimodal,weight:2},{score:sequence,weight:1},{score:contextual,weight:.5}]),complete:sequence!==null&&(c.interaction==='drag'||contextual!==null),modalities,statistical,multimodal,sequence,contextual,exemplar,exemplarCount:compatible.length,matcherVersion:MATCHER_VERSION};
}
