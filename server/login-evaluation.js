import { createHash } from 'node:crypto';
import { BioPrint } from './core.js';
import { ATTACKS } from './evaluation.js';
import { AMBIENT_VERSION } from './ambient.js';
import { PASSIVE_VERSION } from './passive.js';
import { MATCHER_VERSION } from './matching/index.js';
import { LOGIN_POLICY_VERSION, loginReportIssues } from './login-policy.js';

const key='offline-evaluation-only',binding='offline-browser';
const ratio=(n,d)=>d?n/d:null;
function metrics(rows){
  const genuine=rows.filter(r=>r.genuine),impostors=rows.filter(r=>!r.genuine);
  const times=rows.map(r=>r.latencyMs).sort((a,b)=>a-b);
  return {attempts:rows.length,genuine:genuine.length,impostors:impostors.length,
    FAR:ratio(impostors.filter(r=>r.final==='ACCEPT').length,impostors.length),
    FRR:ratio(genuine.filter(r=>r.final!=='ACCEPT').length,genuine.length),
    passiveAcceptRate:ratio(rows.filter(r=>r.passive==='ACCEPT').length,rows.length),
    stepUpRate:ratio(rows.filter(r=>r.passive==='STEP_UP').length,rows.length),
    passiveRejectRate:ratio(rows.filter(r=>r.passive==='REJECT').length,rows.length),
    latencyMs:{p50:times[Math.floor(times.length*.5)]??null,p95:times[Math.min(times.length-1,Math.floor(times.length*.95))]??null}};
}
function validate(dataset){
  if(dataset.schemaVersion!==1||dataset.mode!=='login'||!['recorded','synthetic'].includes(dataset.origin)||!Array.isArray(dataset.records))throw Error('Expected schemaVersion 1, mode login, origin recorded/synthetic and records');
  const ids=new Set(),groups=new Map(),pairs=new Map();
  for(const r of dataset.records){
    const ambient=r.phase==='ambient';
    const device=ambient?r.device:r.challenge?.device;
    if(!r.id||ids.has(r.id)||!r.subjectId||!r.claimedUserId||!r.studySessionId||!['passive','active','ambient'].includes(r.phase)||!['enroll','validation','test'].includes(r.split)||!['genuine',...ATTACKS].includes(r.attack)||!Number.isFinite(r.recordedAt)||!device?.id||!device?.class)throw Error('Every login record needs unique id, phase, identity/session/split/attack labels, recordedAt and a device');
    ids.add(r.id);
    if(!ambient&&r.challenge.userId!==r.claimedUserId||r.attack==='genuine'&&r.subjectId!==r.claimedUserId||r.split==='enroll'&&r.attack!=='genuine')throw Error('Inconsistent identity labels');
    if(ambient&&!Array.isArray(r.events))throw Error('Ambient windows need an events array');
    const group=JSON.stringify([r.subjectId,r.studySessionId]);if(groups.has(group)&&groups.get(group)!==r.split)throw Error('Session leakage: '+group);groups.set(group,r.split);
    if(r.split!=='enroll'){
      if(!r.loginId)throw Error('Login attempts need a loginId');
      if(!ambient&&(typeof r.protocolValid!=='boolean'||r.phase==='passive'&&typeof r.passwordValid!=='boolean'))throw Error('Login attempts need protocolValid and passive passwordValid labels (never credentials)');
      const pair=pairs.get(r.loginId)??{};
      if(ambient)(pair.ambient??=[]).push(r);
      else{if(pair[r.phase])throw Error('Duplicate login phase');pair[r.phase]=r;}
      pairs.set(r.loginId,pair);
    }
  }
  for(const pair of pairs.values()){
    if(!pair.passive)throw Error('Orphan active or ambient recording');
    for(const w of pair.ambient??[]){
      if(['claimedUserId','subjectId','studySessionId','split','attack'].some(k=>pair.passive[k]!==w[k]))throw Error('Mismatched ambient window labels');
      if(w.device.id!==pair.passive.challenge.device.id||w.device.class!==pair.passive.challenge.device.class)throw Error('Mismatched ambient device');
      if(w.recordedAt>pair.passive.recordedAt)throw Error('Ambient window recorded after its login');
    }
    (pair.ambient??[]).sort((a,b)=>a.recordedAt-b.recordedAt);
    if(pair.active&&['claimedUserId','subjectId','studySessionId','split','attack'].some(k=>pair.passive[k]!==pair.active[k]))throw Error('Mismatched login pair');
    if(pair.active&&(pair.passive.challenge.device.id!==pair.active.challenge.device.id||pair.passive.challenge.device.class!==pair.active.challenge.device.class||pair.active.recordedAt<pair.passive.recordedAt))throw Error('Mismatched login device or chronology');
  }
  const enrolledAt=new Map();for(const r of dataset.records.filter(r=>r.split==='enroll'))enrolledAt.set(r.claimedUserId,Math.max(enrolledAt.get(r.claimedUserId)??-Infinity,r.recordedAt));
  for(const {passive:r} of pairs.values())if(!enrolledAt.has(r.claimedUserId)||r.recordedAt<enrolledAt.get(r.claimedUserId))throw Error('Missing or future enrollment for '+r.claimedUserId);
  return pairs;
}
const context=r=>({installId:r.challenge.device.id,class:r.challenge.device.class,scroll:!!r.challenge.scrollTarget});
const ambientContext=r=>({installId:r.device.id,class:r.device.class,scroll:true});
function replayAmbient(core,windows,setClock){
  if(!windows?.length)return null;
  setClock(windows[0].recordedAt);
  const session=core.startAmbient({device:ambientContext(windows[0])},binding);
  let nonce=session.nonce;
  for(const w of windows){
    setClock(w.recordedAt);
    const result=core.ingestAmbient({ambientId:session.ambientId,nonce,events:w.events,hints:w.hints,studySessionId:w.studySessionId},binding);
    nonce=result.nonce;
  }
  return session.ambientId;
}
function recordedChallenge(core,issued,r){
  const c={...issued,...Object.fromEntries(['phrase','targets','interaction','dragStart','scrollTarget'].filter(k=>r.challenge[k]!==undefined).map(k=>[k,r.challenge[k]]))};
  core.db.prepare('UPDATE challenges SET body=? WHERE id=?').run(JSON.stringify(c),c.challengeId);return c;
}
const payload=(c,r,ambientId)=>({challengeId:c.challengeId,nonce:r.protocolValid===false?'invalid-protocol':c.nonce,userId:c.userId,username:c.userId,events:r.events,hints:r.hints,studySessionId:r.studySessionId,...(ambientId?{ambientId}:{})});
function run(dataset,pairs,split,options){
  let now=0;
  const core=new BioPrint(':memory:',key,()=>now,options),rows=[];
  try{
    const enrollment=dataset.records.filter(r=>r.split==='enroll');
    for(const user of new Set(enrollment.map(r=>r.claimedUserId))){
      const flow=core.startEnrollmentFlow(user,key),all=enrollment.filter(r=>r.claimedUserId===user).sort((a,b)=>a.recordedAt-b.recordedAt);
      const records=all.filter(r=>r.phase!=='ambient');
      const ambientId=replayAmbient(core,all.filter(r=>r.phase==='ambient'),t=>{now=t;});
      for(const r of records){
        now=r.recordedAt;const passive=r.phase==='passive',e=passive?flow.passiveEnrollment:flow.activeEnrollment;
        const c=recordedChallenge(core,passive?core.passiveChallenge(user,'passive-enroll',context(r),binding,e):core.challenge(user,'enroll',e.enrollmentId,e.enrollmentToken,context(r),binding),r);
        const body={...payload(c,r),enrollmentToken:e.enrollmentToken};
        const result=passive?core.submitPassive(body,'passive-enroll',binding):core.submit(body,'enroll',binding);
        if(result.decision!=='SAMPLE_ACCEPTED')throw Error('Invalid enrollment '+r.id+': '+result.reasons.join(','));
      }
      core.completeEnrollmentFlow(user,{...flow,ambientId},binding);
    }
    const ordered=[...pairs.values()].filter(p=>p.passive.split===split).sort((a,b)=>a.passive.recordedAt-b.passive.recordedAt);
    for(const {passive:r,active,ambient} of ordered){
      const ambientId=options.ambient===false?null:replayAmbient(core,ambient,t=>{now=t;});
      now=r.recordedAt;const start=performance.now();
      const c=core.passiveChallenge(r.claimedUserId,'passive-auth',context(r),binding);
      const passive=core.submitPassive(payload(c,r,ambientId),'passive-auth',binding,r.passwordValid);
      let final=passive;
      if(passive.decision==='STEP_UP'){
        if(!active)throw Error('Missing active recording for required step-up '+r.loginId+'; capture both phases for calibration');
        now=active.recordedAt;
        try{
          const challenge=recordedChallenge(core,core.stepUpChallenge({userId:r.claimedUserId,loginId:passive.loginId,device:context(active)},binding),active);
          final=core.finishStepUp({...payload(challenge,active),loginId:passive.loginId},binding);
        }catch(e){if(!/^[A-Z_]+$/.test(e.message))throw e;final={decision:'REJECT',reasons:[e.message]};}
      }
      rows.push({id:r.loginId,user:r.claimedUserId,genuine:r.attack==='genuine',attack:r.attack,passive:passive.decision,final:final.decision,reasons:final.reasons,latencyMs:performance.now()-start,
        ambientWindows:ambient?.length??0,ambientUsed:passive.ambient?.used===true,ambientScore:passive.ambient?.identityScore??null,
        ambientForcedStepUp:(passive.reasons??[]).some(x=>['AMBIENT_IDENTITY_UNCERTAIN','AMBIENT_REPLAY','AMBIENT_CANNOT_RESCUE'].includes(x))});
    }
    return rows;
  }finally{core.close();}
}

export function evaluateLogin(dataset,activeOptions={}){
  const activePolicy={advanced:activeOptions.advanced===true,identityThreshold:activeOptions.advanced?activeOptions.identityThreshold:null};
  if(activePolicy.advanced&&(!Number.isFinite(activePolicy.identityThreshold)||activePolicy.identityThreshold<.25||activePolicy.identityThreshold>.99))throw Error('Advanced evaluation requires an approved active threshold');
  const ambientRecords=dataset.records.filter(r=>r.phase==='ambient');
  const hasAmbient=ambientRecords.length>0;
  const runtime={...(activePolicy.advanced?{advanced:true,identityThreshold:activePolicy.identityThreshold}:{}),ambient:hasAmbient};
  const pairs=validate(dataset),validation=[...pairs.values()].filter(p=>p.passive.split==='validation');
  if(!validation.some(p=>p.passive.attack==='genuine')||!validation.some(p=>p.passive.attack!=='genuine'))throw Error('Validation requires genuine and impostor attempts');
  const rank=(a,b)=>(a.metrics.FAR+a.metrics.FRR)-(b.metrics.FAR+b.metrics.FRR)||a.metrics.FAR-b.metrics.FAR||a.metrics.stepUpRate-b.metrics.stepUpRate;
  const candidates=[];
  for(const passiveThreshold of [.85,.9,.95,.97])for(const finalThreshold of [.75,.85,.95])for(const passiveWeight of [.2,.35,.5]){
    const policy={passiveThreshold,finalThreshold,passiveWeight},rows=run(dataset,pairs,'validation',{...runtime,...policy});
    candidates.push({policy,metrics:metrics(rows)});
  }
  candidates.sort(rank);
  let selected=candidates[0];
  const ambientCandidates=[];
  if(hasAmbient){
    for(const ambientWeight of [.1,.2,.3]){
      const policy={...selected.policy,ambientWeight},rows=run(dataset,pairs,'validation',{...runtime,...policy});
      ambientCandidates.push({policy,metrics:metrics(rows)});
    }
    ambientCandidates.sort(rank);
    selected=ambientCandidates[0];
  }
  const test=run(dataset,pairs,'test',{...runtime,...selected.policy}),baselineTest=run(dataset,pairs,'test',runtime);
  const ambientDisabledTest=hasAmbient?run(dataset,pairs,'test',{...runtime,...selected.policy,ambient:false}):null;
  const users=[...new Set(dataset.records.filter(r=>r.split==='enroll').map(r=>r.claimedUserId))];
  const report={schemaVersion:1,mode:'login',origin:dataset.origin,policyVersion:LOGIN_POLICY_VERSION,activePolicy,matcherVersion:MATCHER_VERSION,passiveVersion:PASSIVE_VERSION,sessionSeparated:true,ambientEvaluated:hasAmbient,ambientVersion:AMBIENT_VERSION,createdAt:new Date().toISOString(),datasetHash:createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),users:users.length,policy:selected.policy,validation:selected.metrics,test:metrics(test),baselineTest:metrics(baselineTest),perUser:Object.fromEntries(users.map(u=>[u,metrics(test.filter(r=>r.user===u))])),attacks:Object.fromEntries(ATTACKS.map(a=>[a,metrics(test.filter(r=>r.attack===a))])),attempts:test,calibrationCandidates:candidates,ambientCandidates,
    ambient:hasAmbient?{
      windows:ambientRecords.length,
      attemptsWithAmbient:test.filter(r=>r.ambientWindows>0).length,
      usedRate:ratio(test.filter(r=>r.ambientUsed).length,test.length),
      forcedStepUpRate:ratio(test.filter(r=>r.ambientForcedStepUp).length,test.length),
      genuineForcedStepUpRate:ratio(test.filter(r=>r.genuine&&r.ambientForcedStepUp).length,test.filter(r=>r.genuine).length),
      impostorForcedStepUpRate:ratio(test.filter(r=>!r.genuine&&r.ambientForcedStepUp).length,test.filter(r=>!r.genuine).length),
      disabledTest:metrics(ambientDisabledTest),
      stepUpCost:ratio(test.filter(r=>r.passive==='STEP_UP').length,test.length)-ratio(ambientDisabledTest.filter(r=>r.passive==='STEP_UP').length,ambientDisabledTest.length),
    }:null,
    notes:['No policy file or live database is changed. Deployment additionally requires explicit operator sample-count and FAR limits.','Thresholds and passive weight selected on validation only; test is replayed with frozen settings.','The exact active policy is recorded and must match deployment. Adaptation is disabled during evaluation.','Complete paired captures are required whenever any candidate policy requests step-up.','Protocol validity and password correctness are annotated booleans; credentials are never needed.','Validation and test use separate in-memory databases and enrollment-only initial histories.','FRR includes all genuine final rejections. Replay history evolves chronologically within each split.','Latency includes in-memory protocol, analysis and matching; excludes capture/network time.',...(hasAmbient
      ?['Ambient pre-login evidence is replayed through the real ingest path, including nonce rotation, replay detection and window consumption.','`ambient.disabledTest` is the SAME frozen policy with ambient switched off, which isolates ambient\'s effect on that policy. It is not what the system would do without ambient: the policy was selected with ambient in play, so a deployment without it would have selected different thresholds. Compare against a separate evaluation of an ambient-free dataset for that question.','Ambient weight is selected on validation only, in a second stage after the passive parameters, so the joint optimum is not searched.','`ambient.stepUpCost` is the step-up rate ambient adds under the frozen policy, and is the cost to weigh. Ambient cannot raise the accept rate by construction, so a higher FAR with ambient enabled indicates a defect, not a trade-off.']
      :['This dataset contains no ambient windows, so ambient evidence is disabled and unmeasured here. It is structurally unable to raise the accepted rate, so it cannot inflate FAR, but its effect on FRR and step-up rate is unmeasured.'])]};
  report.deploymentIssues=loginReportIssues(report);report.deploymentEligible=report.deploymentIssues.length===0;return report;
}
