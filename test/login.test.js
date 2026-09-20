import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BioPrint } from '../server/core.js';
import { PASSIVE_ROUNDS, PASSIVE_ROUNDS_MINIMUM } from '../server/passive.js';
import { ACTIVE_ROUNDS } from '../server/scoring.js';
import { MONITOR_IDLE_MS } from '../server/continuous.js';
import { trace, payload } from './fixtures.js';
import { passiveTrace } from './passive-fixtures.js';

const KEY='test-enrollment-secret',BIND='binding-1';
const DEVICE={installId:'install-1',class:'desktop-pointer',scroll:false};
const OWNER={dwell:95,flight:165,pdwell:88,pflight:158,move:17,bow:.09};
const STRANGER={dwell:140,flight:260,pdwell:132,pflight:250,move:24,bow:.15};

function enrolled(t,user='casey',seed=1){
  let now=Date.now();
  const core=new BioPrint(':memory:',KEY,()=>now);
  t.after(()=>core.close());
  const flow=core.startEnrollmentFlow(user,KEY);
  for(let i=0;i<8;i++){
    const c=core.challenge(user,'enroll',flow.activeEnrollment.enrollmentId,flow.activeEnrollment.enrollmentToken,DEVICE,BIND);
    const r=core.submit({...payload(c,trace(c,{seed:i})),enrollmentToken:flow.activeEnrollment.enrollmentToken},'enroll',BIND);
    assert.equal(r.decision,'SAMPLE_ACCEPTED','active round '+(i+1)+': '+JSON.stringify(r.reasons));
    now+=45000;
  }
  for(let i=0;i<PASSIVE_ROUNDS;i++){
    const c=core.passiveChallenge(user,'passive-enroll',DEVICE,BIND,flow.passiveEnrollment);
    const r=core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:user,username:user,
      events:passiveTrace({user,seed:seed*50+i,p:OWNER}),enrollmentToken:flow.passiveEnrollment.enrollmentToken,hints:{}},'passive-enroll',BIND);
    assert.equal(r.decision,'SAMPLE_ACCEPTED','passive round '+(i+1)+': '+JSON.stringify(r.reasons));
    now+=45000;
  }
  const done=core.completeEnrollmentFlow(user,flow,BIND);
  assert.equal(done.enrolled,true);
  const login=(persona,s,extra={})=>{
    now+=60000;
    const c=core.passiveChallenge(user,'passive-auth',DEVICE,BIND);
    return core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:user,username:user,
      events:passiveTrace({user,seed:s,p:persona,...extra}),hints:{}},'passive-auth',BIND,true);
  };
  return {core,user,login,advance:ms=>{now+=ms;},at:()=>now};
}

test('a trained profile accepts its own owner on passive evidence alone',t=>{
  const {login}=enrolled(t,'casey',1);
  const results=[];
  for(let i=0;i<10;i++)results.push(login(OWNER,900+i));
  const accepted=results.filter(r=>r.decision==='ACCEPT').length;
  assert.ok(accepted>=7,`owner accepted ${accepted}/10, scores ${results.map(r=>r.identityScore?.toFixed(3)+'/'+r.threshold.toFixed(2)).join(' ')}`);
  for(const r of results){assert.ok(r.threshold<=.9&&r.threshold>=.4);assert.ok(r.rejectThreshold<r.threshold);assert.equal(r.fraudSignals.length,0);}
});

test('a clearly different typist with the right password is blocked on behavior alone',t=>{
  const {login}=enrolled(t,'dana',2);
  let rejected=0;
  for(let i=0;i<8;i++){
    const r=login(STRANGER,700+i);
    assert.equal(r.allowed,false,'stranger accepted at '+r.identityScore);
    assert.ok(['REJECT','STEP_UP'].includes(r.decision));
    if(r.decision==='REJECT'){rejected++;assert.deepEqual(r.reasons,['IDENTITY_MISMATCH']);assert.ok(r.identityScore<r.rejectThreshold);assert.equal(r.password,'PASS');assert.deepEqual(r.fraudSignals,[]);}
  }
  assert.ok(rejected>=6,'clear mismatches rejected '+rejected+'/8');
});

test('the clear-mismatch band sits between the person and a stranger: a near typist steps up',t=>{
  const {login}=enrolled(t,'eli',4);
  const NEAR={dwell:118,flight:205,pdwell:108,pflight:195,move:20,bow:.12};
  const decisions=Array.from({length:8},(_,i)=>login(NEAR,800+i).decision);
  assert.ok(decisions.filter(d=>d==='STEP_UP').length>=3,decisions.join(' '));
  assert.ok(!decisions.includes('REJECT'),decisions.join(' '));
});

test('an Enter-key submit is a complete capture and the owner is accepted on it',t=>{
  const {login}=enrolled(t,'fay',5);
  let accepted=0;
  for(let i=0;i<8;i++){
    const r=login(OWNER,1000+i,{submit:'keyboard'});
    assert.equal(r.complete,true,'held Enter marked the capture incomplete');
    assert.equal(r.submitMethod,'keyboard');
    assert.ok(r.quality>=.75,'keyboard submit quality '+r.quality);
    assert.ok(!r.reasons.includes('INSUFFICIENT_PASSIVE_EVIDENCE'),r.reasons.join(','));
    assert.equal(r.availability.pointer,'UNAVAILABLE');
    if(r.decision==='ACCEPT')accepted++;
  }
  assert.ok(accepted>=6,'Enter-submitted owner accepted '+accepted+'/8');
  const s=login(STRANGER,1100,{submit:'keyboard'});
  assert.equal(s.allowed,false);assert.ok(['REJECT','STEP_UP'].includes(s.decision));
});

test('passive enrollment reports its round counts and cannot finish below the minimum',t=>{
  let now=Date.now();
  const core=new BioPrint(':memory:',KEY,()=>now);t.after(()=>core.close());
  const flow=core.startEnrollmentFlow('erin',KEY);
  assert.equal(flow.passiveRoundsRequired,PASSIVE_ROUNDS_MINIMUM);
  assert.equal(flow.passiveRoundsRecommended,PASSIVE_ROUNDS);
  assert.equal(flow.activeRoundsRequired,ACTIVE_ROUNDS);
  assert.equal(flow.activeEnrollment.roundsRequired,ACTIVE_ROUNDS);
  for(let i=0;i<ACTIVE_ROUNDS;i++){
    const c=core.challenge('erin','enroll',flow.activeEnrollment.enrollmentId,flow.activeEnrollment.enrollmentToken,DEVICE,BIND);
    const r=core.submit({...payload(c,trace(c,{seed:i})),enrollmentToken:flow.activeEnrollment.enrollmentToken},'enroll',BIND);now+=45000;
    assert.equal(r.readyToComplete,i===ACTIVE_ROUNDS-1);
  }
  let last;
  for(let i=0;i<PASSIVE_ROUNDS_MINIMUM-1;i++){
    const c=core.passiveChallenge('erin','passive-enroll',DEVICE,BIND,flow.passiveEnrollment);
    last=core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:'erin',username:'erin',
      events:passiveTrace({user:'erin',seed:300+i,p:OWNER}),enrollmentToken:flow.passiveEnrollment.enrollmentToken,hints:{}},'passive-enroll',BIND);now+=45000;
  }
  assert.equal(last.readyToComplete,false);assert.equal(last.roundsRequired,PASSIVE_ROUNDS_MINIMUM);
  assert.throws(()=>core.completeEnrollmentFlow('erin',flow,BIND),/MORE_PASSIVE_ENROLLMENT_REQUIRED/);
  for(let i=PASSIVE_ROUNDS_MINIMUM-1;i<PASSIVE_ROUNDS;i++){
    const c=core.passiveChallenge('erin','passive-enroll',DEVICE,BIND,flow.passiveEnrollment);
    last=core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:'erin',username:'erin',
      events:passiveTrace({user:'erin',seed:300+i,p:OWNER}),enrollmentToken:flow.passiveEnrollment.enrollmentToken,hints:{}},'passive-enroll',BIND);now+=45000;
    assert.equal(last.roundsAccepted,i+1);
    if(last.readyToComplete){assert.equal(last.roundsRequired,i+1);break;}
    assert.equal(last.roundsRequired,i+2);
    assert.throws(()=>core.completeEnrollmentFlow('erin',flow,BIND),/MORE_PASSIVE_ENROLLMENT_REQUIRED/);
  }
  assert.equal(last.readyToComplete,true);
  const done=core.completeEnrollmentFlow('erin',flow,BIND);
  assert.equal(done.enrolled,true);assert.equal(done.activeRounds,ACTIVE_ROUNDS);assert.ok(done.passiveRounds>=PASSIVE_ROUNDS_MINIMUM);
  assert.equal(core.status('erin').passiveRoundsRequired,PASSIVE_ROUNDS_MINIMUM);
});

test('monitoring without an ambient profile does not expire the session at the idle timeout',t=>{
  const {core,user,login,advance,at}=enrolled(t,'frank',3);
  let accepted=null;
  for(let i=0;i<20&&!accepted;i++){const r=login(OWNER,600+i);if(r.decision==='ACCEPT')accepted=r;}
  assert.ok(accepted,'no passive ACCEPT available to start monitoring from');
  const m=core.startMonitoring({loginId:accepted.loginId,userId:user,device:DEVICE},BIND);
  advance(MONITOR_IDLE_MS+60000);
  const c=core.monitorChallenge({monitorId:m.monitorId,userId:user},BIND);
  const r=core.submitMonitor({monitorId:m.monitorId,userId:user,challengeId:c.challengeId,nonce:c.nonce,
    events:browsing(1),hints:{}},BIND);
  assert.equal(r.reauthenticationRequired,false,'forced re-login with reasons '+JSON.stringify(r.reasons));
  assert.deepEqual(r.reasons,['AMBIENT_PROFILE_MISSING']);
  assert.ok(at()<m.maxExpiresAt);
});

let s=7;const rnd=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};
function browsing(seed){
  s=seed*131+5;const ev=[];let t=10;
  for(let i=0;i<70;i++){ev.push({type:'move',x:.2+rnd()*.6,y:.2+rnd()*.6,pointerType:'mouse',t:Math.round(t),trusted:true});t+=18+rnd()*22;}
  for(let i=0;i<20;i++){ev.push({type:'scroll',position:Math.min(1,i/22+rnd()*.02),t:Math.round(t),trusted:true});t+=90+rnd()*140;}
  for(let i=0;i<14;i++){const d=t;ev.push({type:'keydown',position:i,action:'character',t:Math.round(d),trusted:true});
    ev.push({type:'keyup',position:i,action:'character',t:Math.round(d+70+rnd()*60),trusted:true});t=d+140+rnd()*110;}
  ev.push({type:'down',x:.5,y:.5,pointerType:'mouse',t:Math.round(t),trusted:true});t+=80+rnd()*50;
  ev.push({type:'up',x:.5,y:.5,pointerType:'mouse',t:Math.round(t),trusted:true});
  let last=-1;return ev.sort((a,b)=>a.t-b.t).map(e=>{if(e.t<last)e.t=last;last=e.t;return e;});
}
