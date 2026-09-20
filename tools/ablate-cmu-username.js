import { readFileSync } from 'node:fs';
import { analyzePassive, passiveModel, matchPassive } from '../server/passive.js';
const lines=readFileSync(new URL('../data/benchmark/DSL-StrongPasswordData.csv',import.meta.url),'utf8').trim().split(/\r?\n/);
const header=lines[0].split(','),col=Object.fromEntries(header.map((h,i)=>[h,i]));
const KEYS=['period','t','i','e','five','Shift.r','o','a','n','l'],CHARS=['.','t','i','e','5','R','o','a','n','l'],CODES=['Period','KeyT','KeyI','KeyE','Digit5','KeyR','KeyO','KeyA','KeyN','KeyL'];
const rows=lines.slice(1).map(l=>l.split(','));const subjects=[...new Set(rows.map(r=>r[0]))];
function timeline(r){const downs=[],ups=[];let t=300;for(let i=0;i<KEYS.length;i++){if(i>0)t+=1000*Number(r[col['DD.'+KEYS[i-1]+'.'+KEYS[i]]]);downs.push(t);ups.push(t+1000*Number(r[col['H.'+KEYS[i]]]));}return {downs,ups,enter:downs.at(-1)+1000*Number(r[col['DD.l.Return']])};}
function toEvents(r){const {downs,ups,enter}=timeline(r);const ev=[];for(let i=0;i<KEYS.length;i++){const d={field:'username',position:i,action:'character',key:CHARS[i],code:CODES[i]};ev.push({type:'keydown',...d,t:downs[i],trusted:true});ev.push({type:'keyup',...d,t:ups[i],trusted:true});ev.push({type:'input',field:'username',source:'typing',t:downs[i]+1,trusted:true});}ev.sort((a,b)=>a.t-b.t);ev.push({type:'submit',method:'keyboard',t:Math.max(enter,ev.at(-1).t),trusted:true});return ev;}
const VARIANTS={
  current:s=>s,
  noTrigraph:s=>Object.fromEntries(Object.entries(s).filter(([k])=>!k.startsWith('trigraph:'))),
  plusKeyDwell:(s,r)=>({...s,...keyDwell(r)}),
  noTrigraphPlusKeyDwell:(s,r)=>({...VARIANTS.noTrigraph(s),...keyDwell(r)}),
  perKeyOnly:(s,r)=>({...Object.fromEntries(Object.entries(s).filter(([k])=>k.startsWith('digraph:'))),...keyDwell(r)}),
  perKeyPlusUpDown:(s,r)=>({...VARIANTS.perKeyOnly(s,r),...keyUpDown(r)}),
};
function keyDwell(r){const {downs,ups}=timeline(r);const o={};for(let i=0;i<KEYS.length;i++)o['key:'+CHARS[i]+':dwell']=ups[i]-downs[i];return o;}
function keyUpDown(r){const {downs,ups}=timeline(r);const o={};for(let i=1;i<KEYS.length;i++)o['keyud:'+CHARS[i-1]+CHARS[i]]=downs[i]-ups[i-1];return o;}
const data={};
for(const r of rows){const a=analyzePassive(toEvents(r));(data[r[0]]??=[]).push({session:Number(r[1]),rep:Number(r[2]),base:{stats:a.stats,evidenceQuality:a.evidenceQuality,quality:a.quality},r});}
for(const s of subjects)data[s].sort((a,b)=>a.session-b.session||a.rep-b.rep);
function eer(g,im){g=g.filter(Number.isFinite).sort((a,b)=>a-b);im=im.filter(Number.isFinite).sort((a,b)=>a-b);const c=[...new Set([...g,...im])].sort((a,b)=>a-b);let best={eer:1,far:1,frr:0};const below=(arr,t)=>{let lo=0,hi=arr.length;while(lo<hi){const m=(lo+hi)>>1;if(arr[m]<t)lo=m+1;else hi=m;}return lo;};for(const t of c){const frr=below(g,t)/g.length,far=1-below(im,t)/im.length;if(Math.abs(far-frr)<Math.abs(best.far-best.frr))best={eer:(far+frr)/2,far,frr};}return best.eer;}
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
function sample(rec,variant){return {...rec.base,stats:{...rec.base.stats,username:VARIANTS[variant](rec.base.stats.username,rec.r)}};}
const KERNELS={
  geoGauss:f=>{let sw=0,s=0;for(const x of f){sw+=x.weight;s+=x.weight*.5*Math.min(4,x.z)**2;}return Math.exp(-s/sw);},
  geoLaplace4:f=>{let sw=0,s=0;for(const x of f){sw+=x.weight;s+=x.weight*Math.min(4,x.z);}return Math.exp(-s/sw);},
  geoLaplaceUnclipped:f=>{let sw=0,s=0;for(const x of f){sw+=x.weight;s+=x.weight*x.z;}return Math.exp(-s/sw);},
  geoLaplaceUnweighted:f=>{let s=0;for(const x of f)s+=x.z;return Math.exp(-s/f.length);},
};
const enrollments={'200 reps':reps=>reps.slice(0,200),'10 reps (last)':reps=>reps.slice(190,200)};
const out=[];
for(const [ename,trainIdx] of Object.entries(enrollments))for(const variant of Object.keys(VARIANTS)){
  const per={};for(const k of Object.keys(KERNELS))per[k]=[];
  let nfeat=0;
  for(const subject of subjects){
    const reps=data[subject];const train=trainIdx(reps).map(x=>sample(x,variant));
    const profile={model:passiveModel(train)};nfeat=Object.keys(profile.model.username).length;
    const score=x=>{const m=matchPassive(sample(x,variant),profile);const f=m.features.username.filter(t=>Number.isFinite(t.z));return Object.fromEntries(Object.entries(KERNELS).map(([k,fn])=>[k,fn(f)]));};
    const g=reps.slice(200).map(score),im=subjects.filter(s=>s!==subject).flatMap(s=>data[s].slice(0,5).map(score));
    for(const k of Object.keys(KERNELS))per[k].push(eer(g.map(x=>x[k]),im.map(x=>x[k])));
  }
  out.push({enrollment:ename,variant,features:nfeat,...Object.fromEntries(Object.entries(per).map(([k,v])=>[k,(100*mean(v)).toFixed(1)+'%']))});
}
console.table(out);
