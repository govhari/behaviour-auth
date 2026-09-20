import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BioPrint } from '../server/core.js';
import { explain } from '../server/explain.js';
import { PASSIVE_ROUNDS, analyzePassive } from '../server/passive.js';
import { ACTIVE_ROUNDS } from '../server/scoring.js';
import { trace, payload } from './fixtures.js';
import { passiveTrace, botTrace } from './passive-fixtures.js';

const KEY='test-enrollment-secret',BIND='binding-1';
const DEVICE={installId:'install-1',class:'desktop-pointer',scroll:false};
const OWNER={dwell:95,flight:165,pdwell:88,pflight:158,move:17,bow:.09};
const STRANGER={dwell:140,flight:260,pdwell:132,pflight:250,move:24,bow:.15};

function enrolled(t,user='alice',seed=1,options={explain:true}){
  let now=Date.now();
  const core=new BioPrint(':memory:',KEY,()=>now,options);
  t.after(()=>core.close());
  const flow=core.startEnrollmentFlow(user,KEY);
  for(let i=0;i<ACTIVE_ROUNDS;i++){
    const c=core.challenge(user,'enroll',flow.activeEnrollment.enrollmentId,flow.activeEnrollment.enrollmentToken,DEVICE,BIND);
    const r=core.submit({...payload(c,trace(c,{seed:i})),enrollmentToken:flow.activeEnrollment.enrollmentToken},'enroll',BIND);
    assert.equal(r.decision,'SAMPLE_ACCEPTED',JSON.stringify(r.reasons));now+=45000;
  }
  for(let i=0;i<PASSIVE_ROUNDS;i++){
    const c=core.passiveChallenge(user,'passive-enroll',DEVICE,BIND,flow.passiveEnrollment);
    const r=core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:user,username:user,
      events:passiveTrace({user,seed:seed*50+i,p:OWNER}),enrollmentToken:flow.passiveEnrollment.enrollmentToken,hints:{}},'passive-enroll',BIND);
    assert.equal(r.decision,'SAMPLE_ACCEPTED',JSON.stringify(r.reasons));now+=45000;
  }
  assert.equal(core.completeEnrollmentFlow(user,flow,BIND).enrolled,true);
  const login=(events,hints={})=>{
    now+=60000;
    const c=core.passiveChallenge(user,'passive-auth',DEVICE,BIND);
    return core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:user,username:user,events,hints},'passive-auth',BIND,true);
  };
  return {core,user,login,advance:ms=>{now+=ms;}};
}
const shape=(r,verdicts=['match','mismatch','suspicious','unavailable','pass'])=>{
  const e=r.explanation;
  assert.ok(e&&typeof e.headline==='string'&&e.headline.length>10,'headline');
  assert.ok(typeof e.summary==='string'&&e.summary.length>10,'summary');
  assert.equal(e.verdict,r.decision);
  assert.ok(e.confidence===null||e.confidence>=0&&e.confidence<=1);
  assert.ok(Array.isArray(e.signals)&&e.signals.length>=3);
  for(const s of e.signals){assert.ok(verdicts.includes(s.verdict),s.verdict);assert.ok(typeof s.key==='string'&&typeof s.label==='string'&&typeof s.detail==='string'&&s.detail.length>0);assert.ok(s.score===null||Number.isFinite(s.score));assert.ok(s.weight===null||Number.isFinite(s.weight));}
  assert.ok(Array.isArray(e.fraud));for(const f of e.fraud)assert.ok(f.code&&f.label&&f.detail);
  assert.deepEqual(r.fraudSignals,e.fraud.map(f=>f.code));
  assert.ok(Number.isFinite(r.latencyMs)&&r.latencyMs>=0&&r.latencyMs<250,'latencyMs '+r.latencyMs);
  return e;
};

test('a scripted login with the right password is rejected as automation at the passive stage',t=>{
  const {login,user}=enrolled(t);
  const r=login(botTrace({user}));
  assert.equal(r.decision,'REJECT');
  assert.deepEqual(r.reasons,['AUTOMATION_RISK']);
  assert.equal(r.password,'PASS');
  assert.ok(r.fraudSignals.includes('AUTOMATION_RISK'));
  for(const code of ['ALL_EVENTS_UNTRUSTED','SYNTHETIC_POINTER_PATH','UNIFORM_PASSWORD_TIMING'])assert.ok(r.fraudSignals.includes(code),code);
  assert.ok(r.hardSignals.length>=1);
  const e=shape(r);
  assert.match(e.headline,/^Blocked: scripted input detected/);
  assert.equal(e.signals.find(s=>s.key==='humanity').verdict,'suspicious');
  assert.ok(e.fraud.length>=3);
});

test('each hard automation rule rejects on its own, and weak hints alone do not',t=>{
  const {login,user}=enrolled(t);
  const untrusted=login(passiveTrace({user,seed:77,p:OWNER}).map(e=>({...e,trusted:false})));
  assert.equal(untrusted.decision,'REJECT');assert.ok(untrusted.fraudSignals.includes('ALL_EVENTS_UNTRUSTED'));
  const timed=login(botTrace({user,trusted:true}));
  assert.equal(timed.decision,'REJECT');assert.ok(timed.fraudSignals.includes('SYNTHETIC_POINTER_PATH'));
  const events=passiveTrace({user,seed:78,p:OWNER});events[3]={...events[3],trusted:false};
  const hint=login(events);
  assert.notEqual(hint.decision,'REJECT');
  assert.ok(hint.fraudSignals.includes('SYNTHETIC_EVENT_HINT'));
  assert.ok(!hint.reasons.includes('AUTOMATION_RISK'));
});

test('an exact replay of a genuine login is rejected as replay, not as identity',t=>{
  const {login,user}=enrolled(t);
  const events=passiveTrace({user,seed:4242,p:OWNER});
  const first=login(events);
  assert.ok(['ACCEPT','STEP_UP'].includes(first.decision));
  assert.deepEqual(first.fraudSignals,[]);
  const again=login(events.map(e=>({...e,t:e.t+37})));
  assert.equal(again.decision,'REJECT');
  assert.deepEqual(again.reasons,['EXACT_REPLAY']);
  assert.deepEqual(again.fraudSignals,['EXACT_REPLAY']);
  const e=shape(again);
  assert.match(e.headline,/replay/i);
  assert.equal(e.signals.find(s=>s.key==='freshness').verdict,'suspicious');
});

test('a slightly noisy human is never flagged as fraud',t=>{
  const {login,user}=enrolled(t);
  for(let i=0;i<12;i++){
    const r=login(passiveTrace({user,seed:1200+i,p:OWNER}));
    assert.ok(['ACCEPT','STEP_UP'].includes(r.decision),r.decision+' '+r.reasons);
    assert.deepEqual(r.fraudSignals,[]);
    assert.ok(r.humanScore>=.9);
    const e=shape(r);
    assert.equal(e.signals.find(s=>s.key==='humanity').verdict,'pass');
    assert.equal(e.signals.find(s=>s.key==='freshness').verdict,'pass');
  }
  const stranger=login(passiveTrace({user,seed:1300,p:STRANGER}));
  assert.ok(['REJECT','STEP_UP'].includes(stranger.decision));
  assert.ok(!stranger.reasons.includes('AUTOMATION_RISK'));
  assert.deepEqual(stranger.fraudSignals,[]);
});

test('explanations name the modalities and, with explain on, the concrete features that moved the score',t=>{
  const {login,user}=enrolled(t);
  const owner=login(passiveTrace({user,seed:1400,p:OWNER}));
  const e=shape(owner);
  assert.deepEqual(e.signals.slice(0,6).map(s=>s.key),['identity','username','password','pointer','click','crossModal']);
  const identity=e.signals[0];
  assert.equal(identity.threshold,Number(owner.threshold.toFixed(3)));
  assert.equal(identity.rejectThreshold,Number(owner.rejectThreshold.toFixed(3)));
  assert.deepEqual(e.thresholds,{accept:identity.threshold,reject:identity.rejectThreshold});
  for(const key of ['humanity','freshness','evidence','device','credential'])assert.ok(e.signals.some(s=>s.key===key),key);
  assert.equal(e.confidence,Number(owner.identityScore.toFixed(3)));
  const stranger=login(passiveTrace({user,seed:1401,p:STRANGER}));
  const se=shape(stranger);
  assert.match(se.headline,stranger.decision==='REJECT'?/^Blocked: .* not match alice's profile/:/^Extra check: password correct/);
  if(stranger.decision==='REJECT')assert.match(se.signals[0].detail,/clear-mismatch bar/);
  const password=se.signals.find(s=>s.key==='password');
  assert.equal(password.verdict,'mismatch');
  assert.match(password.detail,/\d+ ms vs \d+ ms/);
  assert.ok(!/key[:=]/i.test(JSON.stringify(se)));
  assert.equal(se.signals.find(s=>s.key==='humanity').verdict,'pass');
});

test('without the explain option the explanation still exists but carries no enrolled centres',t=>{
  const {login,user}=enrolled(t,'bob',2,{});
  const r=login(passiveTrace({user,seed:1500,p:STRANGER}));
  assert.equal(r.features,undefined);
  const e=shape(r);
  assert.ok(!/enrolled median/.test(JSON.stringify(e)));
  assert.match(e.signals.find(s=>s.key==='password').detail,/scored .* against a bar of/);
});

test('step-up, active and monitor results carry explanation, fraud signals and latency too',t=>{
  const {core,login,user,advance}=enrolled(t);
  const NEW_DEVICE={installId:'install-2',class:'desktop-pointer',scroll:false};
  const stepUp=seed=>{advance(60000);const c=core.passiveChallenge(user,'passive-auth',NEW_DEVICE,BIND);return core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:user,username:user,events:passiveTrace({user,seed,p:OWNER}),hints:{}},'passive-auth',BIND,true);};
  const su=stepUp(1600);
  assert.equal(su.decision,'STEP_UP');assert.ok(su.reasons.includes('NEW_DEVICE'));
  const c=core.stepUpChallenge({loginId:su.loginId,userId:user,device:NEW_DEVICE},BIND);
  const fin=core.finishStepUp({loginId:su.loginId,userId:user,challengeId:c.challengeId,nonce:c.nonce,events:trace(c,{seed:21})},BIND);
  assert.equal(fin.phase,'final');
  assert.deepEqual(fin.fraudSignals,[]);
  const w=fin.fusionWeights;assert.ok(Math.abs(fin.threshold-(w.passive*fin.stageThresholds.passive+w.active*fin.stageThresholds.active)/(w.passive+w.active))<1e-9);
  assert.equal(fin.decision,'ACCEPT','owner step-up: '+fin.reasons+' '+fin.identityScore+' vs '+fin.threshold);
  const fe=shape(fin);
  assert.ok(fe.signals.some(s=>s.key==='passiveStage'));
  assert.ok(fin.active.explanation&&fin.passive.explanation);
  assert.ok(Number.isFinite(fin.active.latencyMs));
  const su2=stepUp(1601);
  const c2=core.stepUpChallenge({loginId:su2.loginId,userId:user,device:NEW_DEVICE},BIND);
  const bot=core.finishStepUp({loginId:su2.loginId,userId:user,challengeId:c2.challengeId,nonce:c2.nonce,events:trace(c2,{uniform:true,seed:5}).map(e=>({...e,trusted:false}))},BIND);
  assert.equal(bot.decision,'REJECT');
  assert.ok(bot.fraudSignals.includes('AUTOMATION_RISK')&&bot.fraudSignals.includes('UNTRUSTED_EVENTS'));
  assert.match(bot.explanation.headline,/^Blocked: scripted input detected/);
  // Direct active verification.
  const ac=core.challenge(user,'auth',undefined,undefined,DEVICE,BIND);
  const ar=core.submit(payload(ac,trace(ac,{seed:9})),'auth',BIND);
  const ae=shape(ar);
  assert.deepEqual(ae.signals.slice(0,2).map(s=>s.key),['keyboard','pointer']);
  // Monitoring.
  let accepted=null;for(let i=0;i<20&&!accepted;i++){const r=login(passiveTrace({user,seed:1700+i,p:OWNER}));if(r.decision==='ACCEPT')accepted=r;}
  assert.ok(accepted,'no passive ACCEPT to monitor from');
  const m=core.startMonitoring({loginId:accepted.loginId,userId:user,device:DEVICE},BIND);
  advance(1000);
  const mc=core.monitorChallenge({monitorId:m.monitorId,userId:user},BIND);
  const mr=core.submitMonitor({monitorId:m.monitorId,userId:user,challengeId:mc.challengeId,nonce:mc.nonce,events:[],hints:{}},BIND);
  shape(mr);
  assert.equal(mr.explanation.verdict,mr.decision);
});

test('explain is deterministic and tolerant of bare results',()=>{
  const a=analyzePassive(passiveTrace({user:'alice',seed:5,p:OWNER}),{});
  assert.equal(a.hardAutomation,false);assert.deepEqual(a.hardSignals,[]);
  const bare={decision:'REJECT',allowed:false,reasons:['INVALID_CHALLENGE']};
  const one=explain(bare,{kind:'passive',user:'alice'}),two=explain(bare,{kind:'passive',user:'alice'});
  assert.deepEqual(one,two);
  assert.match(one.headline,/no such challenge/);
  assert.equal(explain(null),null);
});

test('password positional timing is learned by slot, never by key, and lifts the password modality',()=>{
  const a=analyzePassive(passiveTrace({user:'alice',seed:9,p:OWNER}),{});
  assert.ok(Number.isFinite(a.stats.password['pos:0:dwell'])&&Number.isFinite(a.stats.password['pos:0-1:dd']));
  assert.ok(!Object.keys(a.stats.password).some(k=>/[a-z]{2,}$/.test(k.replace(/^pos:[\d-]+:(dwell|dd)$/,''))&&!/^(dwell|flight|overlap|correction|pauseRatio|upDown|pauseMedian|pauseSpread|burstLength|modifierRatio)$/.test(k)),Object.keys(a.stats.password).join(','));
  // A typo: the retyped character lands on the same slot.
  const events=passiveTrace({user:'alice',seed:10,p:OWNER});
  const firstPassword=events.findIndex(e=>e.type==='keydown'&&e.field==='password');
  const t=events[firstPassword].t;
  const typo=[{type:'keydown',field:'password',position:900,action:'character',t:t-300,trusted:true},{type:'keyup',field:'password',position:900,action:'character',t:t-220,trusted:true},{type:'keydown',field:'password',position:901,action:'correction',t:t-150,trusted:true},{type:'keyup',field:'password',position:901,action:'correction',t:t-80,trusted:true}];
  const b=analyzePassive([...events.slice(0,firstPassword),...typo,...events.slice(firstPassword)].sort((x,y)=>x.t-y.t),{});
  assert.equal(Object.keys(b.stats.password).filter(k=>k.endsWith(':dwell')).length,Object.keys(a.stats.password).filter(k=>k.endsWith(':dwell')).length);
});

test('calibration carries both bars, per-modality bars and a readable rule',t=>{
  const {core,user}=enrolled(t);
  const p=core.profile(user).passive;
  assert.ok(p.threshold>=.4&&p.threshold<=.9);
  assert.ok(p.rejectThreshold>=0&&p.rejectThreshold<=p.threshold-.1+1e-9);
  assert.match(p.calibration.rule,/^accept=clamp\(p10\(LOO\)/);
  for(const m of ['username','password','pointer','click','crossModal'])assert.ok(Number.isFinite(p.calibration.modalities[m]?.threshold),m);
});

test('passive adaptation is reachable for a human-scale profile and keeps its quarantine rules',t=>{
  const {core,login,user,advance}=enrolled(t,'gus',6,{explain:true,passiveAdaptation:true});
  const states=[];
  for(let i=0;i<12&&!states.includes('promoted');i++){
    advance(11*60000);
    const r=login(passiveTrace({user,seed:1900+i,p:OWNER}));
    if(r.decision==='ACCEPT')states.push(r.passiveAdaptation.state);
  }
  assert.ok(states.includes('quarantined'),states.join(','));
  assert.ok(states.includes('promoted'),states.join(','));
  const p=core.profile(user).passive;const device=Object.values(p.devices)[0];
  assert.ok(device.anchorModel,'anchor kept');assert.ok(device.threshold>=.4);
  // Back to back samples wait, whatever their score.
  const r=login(passiveTrace({user,seed:1950,p:OWNER}));
  if(r.decision==='ACCEPT')assert.ok(['waiting','ineligible','quarantined'].includes(r.passiveAdaptation.state));
});
