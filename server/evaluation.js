import { createHash } from 'node:crypto';
import { analyze, calibrate, similarity } from './scoring.js';
import { buildAdvanced, matchAdvanced, fuse, MATCHER_VERSION } from './matching/index.js';
import { nearReplay } from './security/replay.js';

export const ATTACKS=['zero-effort','mimic','fixed-bot','random-bot','synthetic','exact-replay','perturbed-replay','webdriver'];
const rate=(n,d)=>d?n/d:null;
function metrics(rows,threshold){
  const genuine=rows.filter(r=>r.genuine),impostors=rows.filter(r=>!r.genuine);
  const accepted=r=>r.eligible&&Number.isFinite(r.score)&&r.score>threshold;
  return {genuine:genuine.length,impostors:impostors.length,FAR:rate(impostors.filter(accepted).length,impostors.length),FRR:rate(genuine.filter(r=>!accepted(r)).length,genuine.length),moreData:rows.filter(r=>r.moreData).length};
}
function operatingPoint(rows){
  if(!rows.some(r=>r.genuine)||!rows.some(r=>!r.genuine))return null;
  const thresholds=[0,...new Set(rows.map(r=>r.score).filter(Number.isFinite)),1].sort((a,b)=>a-b);
  return thresholds.map(threshold=>({threshold,...metrics(rows,threshold)})).sort((a,b)=>(a.FAR+a.FRR)-(b.FAR+b.FRR)||a.FAR-b.FAR)[0];
}
function eer(rows){
  if(!rows.some(r=>r.genuine)||!rows.some(r=>!r.genuine))return null;
  let best=null;for(const threshold of [0,...new Set(rows.map(r=>r.score).filter(Number.isFinite)),1]){const m=metrics(rows,threshold),gap=Math.abs(m.FAR-m.FRR);if(!best||gap<best.gap)best={threshold,gap,value:(m.FAR+m.FRR)/2,FAR:m.FAR,FRR:m.FRR};}return best;
}
const percentile=(values,q)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(q*values.length))]:null;
export function evaluate(dataset){
  if(dataset.mode==='passive'||dataset.records?.some(r=>r.phase==='passive'))throw Error('Passive captures need passive-policy evaluation; the A–F runner accepts active recordings only');
  if(dataset.schemaVersion!==1||!Array.isArray(dataset.records)||!['recorded','synthetic'].includes(dataset.origin))throw Error('Dataset requires schemaVersion 1, origin recorded/synthetic and records');
  const records=dataset.records,groups=new Map(),seen=new Set();
  for(const r of records){
    if(!r.id||seen.has(r.id)||!r.subjectId||!r.claimedUserId||!r.studySessionId||!['enroll','validation','test'].includes(r.split)||!['genuine',...ATTACKS].includes(r.attack))throw Error('Every record needs unique id, subjectId, claimedUserId, studySessionId, split and attack');seen.add(r.id);
    if((r.attack==='genuine'&&r.subjectId!==r.claimedUserId)||(r.split==='enroll'&&r.attack!=='genuine'))throw Error('Enrollment/genuine identity labels are inconsistent');
    const key=r.subjectId+':'+r.studySessionId;if(groups.has(key)&&groups.get(key)!==r.split)throw Error('Session leakage: '+key);groups.set(key,r.split);
  }
  const users=[...new Set(records.filter(r=>r.split==='enroll').map(r=>r.claimedUserId))],profiles=new Map();
  for(const user of users){const enrollment=records.filter(r=>r.split==='enroll'&&r.claimedUserId===user).map(r=>({...r,derived:analyze(r.challenge,r.events)}));if(enrollment.length<8||enrollment.some(r=>r.derived.quality<1||r.derived.humanScore<.6))throw Error('At least eight valid enrollment rounds required for '+user);profiles.set(user,{baseline:calibrate(enrollment.map(r=>r.derived.feature)),advanced:buildAdvanced(enrollment),enrollment});}
  const variants=Object.fromEntries(['A','B','C','D','E','F'].map(k=>[k,[]]));
  for(const r of records.filter(r=>r.split!=='enroll')){
    const p=profiles.get(r.claimedUserId);if(!p)throw Error('Missing enrollment for '+r.claimedUserId);
    const start=performance.now();let a,error;try{a=analyze(r.challenge,r.events);}catch(e){error=e.message;}
    const baseline=a?similarity(a.feature,p.baseline).score:null;
    const baselineMs=performance.now()-start,adv=a?matchAdvanced(a,r.challenge,p.advanced):null;
    const elapsed=performance.now()-start;
    const fresh=a&&!p.enrollment.some(x=>x.derived.signature===a.signature||nearReplay(a.replayFingerprint,x.derived.replayFingerprint))&&r.protocolValid!==false;
    const scores={A:baseline,B:adv?.exemplar==null?null:fuse([{score:baseline,weight:2},{score:adv.exemplar,weight:1}]),C:adv?.sequence==null?null:fuse([{score:baseline,weight:2},{score:adv.exemplar,weight:1},{score:adv.sequence,weight:1}]),D:adv?.complete?fuse([{score:adv.statistical,weight:2},{score:adv.sequence,weight:1},{score:adv.contextual,weight:.5}]):null,E:adv?.complete?adv.score:null,F:adv?.complete?adv.score:null};
    for(const [variant,score] of Object.entries(scores))variants[variant].push({id:r.id,user:r.claimedUserId,split:r.split,attack:r.attack,genuine:r.attack==='genuine',score:score??null,eligible:!error&&a.quality===1&&a.complete&&a.humanScore>=.6&&Number.isFinite(score)&&(variant!=='F'||fresh),moreData:!error&&(a.quality<1||!a.complete||score==null),latencyMs:variant==='A'?baselineMs:elapsed});
  }
  const report={schemaVersion:1,matcherVersion:MATCHER_VERSION,createdAt:new Date().toISOString(),datasetHash:createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),origin:dataset.origin,sessionSeparated:true,users:users.length,records:records.length,variants:{},notes:['EER is a discrete threshold approximation; FRR includes MORE_DATA.','Thresholds are selected only on validation records; test records are held out.','A–E intentionally omit historical replay gates for ablation; task validity and humanity remain mandatory.','Latency covers analysis and matching, excludes transport and database I/O; B–F share the bounded matcher timing.']};
  for(const [name,rows] of Object.entries(variants)){
    const validation=rows.filter(r=>r.split==='validation'),test=rows.filter(r=>r.split==='test'),point=operatingPoint(validation),threshold=point?.threshold??null;
    report.variants[name]={threshold,validation:point,test:threshold===null?null:metrics(test,threshold),EER:eer(test),latencyMs:{p50:percentile(test.map(r=>r.latencyMs),.5),p95:percentile(test.map(r=>r.latencyMs),.95)},perUser:Object.fromEntries(users.map(u=>[u,threshold===null?null:metrics(test.filter(r=>r.user===u),threshold)])),attacks:Object.fromEntries(ATTACKS.map(attack=>[attack,threshold===null?null:metrics(test.filter(r=>r.attack===attack),threshold)]))};
  }
  const A=report.variants.A.test,F=report.variants.F.test;
  report.advancedEligible=dataset.origin==='recorded'&&users.length>=2&&A?.FAR!==null&&F?.FAR!==null&&!!A&&!!F&&F.FAR<=A.FAR&&F.FRR<=A.FRR&&(F.FAR<A.FAR||F.FRR<A.FRR)&&ATTACKS.every(k=>report.variants.F.attacks[k]?.impostors>0);
  return report;
}
