import { randomBytes, randomUUID } from 'node:crypto';
import { analyzePassive, calibratePassive, matchPassive, passiveNearReplay, passiveConsistent, passiveBars, PASSIVE_ROUNDS, PASSIVE_ROUNDS_MINIMUM, PASSIVE_ROUNDS_MAXIMUM, PASSIVE_VERSION, PASSIVE_WEIGHTS } from './passive.js';
import { ACTIVE_ROUNDS, ACTIVE_ROUNDS_RECOMMENDED, ACTIVE_ROUNDS_MAXIMUM } from './scoring.js';
import { annotate } from './explain.js';

const reject=reason=>({decision:'REJECT',allowed:false,reasons:[reason],phase:'passive',fresh:false,provisional:true});
export const ROUND_REQUIREMENTS={passiveRoundsRequired:PASSIVE_ROUNDS_MINIMUM,passiveRoundsRecommended:PASSIVE_ROUNDS,passiveRoundsMaximum:PASSIVE_ROUNDS_MAXIMUM,activeRoundsRequired:ACTIVE_ROUNDS,activeRoundsRecommended:ACTIVE_ROUNDS_RECOMMENDED,activeRoundsMaximum:ACTIVE_ROUNDS_MAXIMUM};
export function passiveReadiness(records){
  const n=records.length;
  if(n>=PASSIVE_ROUNDS)return {ready:true,consistent:true,roundsRequired:PASSIVE_ROUNDS};
  if(n<PASSIVE_ROUNDS_MINIMUM)return {ready:false,consistent:null,roundsRequired:PASSIVE_ROUNDS_MINIMUM};
  const consistent=passiveConsistent(calibratePassive(records.map(r=>r.derived)),n);
  return {ready:consistent,consistent,roundsRequired:consistent?n:n+1};
}
function consume(core,id){
  if(typeof id!=='string')return null;
  core.db.exec('BEGIN IMMEDIATE');
  try{const row=core.db.prepare('SELECT * FROM challenges WHERE id=?').get(id);if(row&&!row.used)core.db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(id);core.db.exec('COMMIT');return row;}catch(e){core.db.exec('ROLLBACK');throw e;}
}
function passiveEnrollment(core,user,id,token){
  const row=core.db.prepare('SELECT * FROM passive_enrollments WHERE user=? AND id=? AND token=? AND completed=0').get(user,id??'',token??'');if(!row)throw Error('INVALID_PASSIVE_ENROLLMENT');return row;
}
function passiveRecords(core,id){return core.db.prepare('SELECT body FROM passive_sessions WHERE enrollment=? AND trusted=1 ORDER BY rowid').all(id).map(r=>JSON.parse(r.body));}
function deviceEnrollment(core,id,binding,device){
  const row=core.db.prepare('SELECT * FROM device_enrollments WHERE id=?').get(id);
  if(row){
    if(core.clock()>=row.expires)throw Error('EXPIRED_DEVICE_ENROLLMENT');
    if(row.binding!==binding)throw Error('ENROLLMENT_BINDING_MISMATCH');
    if(device&&row.device!==device.id)throw Error('DEVICE_BINDING_MISMATCH');
  }
  return row;
}

export const loginMethods={
  startDeviceEnrollment(user,key,context={},binding=null){
    this.validUser(user);if(!this.authorized(key))throw Error('ENROLLMENT_UNAUTHORIZED');
    const profile=this.profile(user);if(!profile?.passive)throw Error('PASSIVE_PROFILE_REQUIRED');
    const device=this.device(context);
    if(!context.installId)throw Error('DEVICE_INSTALLATION_ID_REQUIRED');
    if(profile.passive.devices?.[device.id]?.status==='trusted')throw Error('DEVICE_ALREADY_ENROLLED');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      let row=this.db.prepare('SELECT * FROM passive_enrollments WHERE user=?').get(user);
      if(row&&!row.completed){
        const old=this.db.prepare('SELECT * FROM device_enrollments WHERE id=?').get(row.id);
        if(!old||old.expires>this.clock()){
          if(!old)throw Error('ENROLLMENT_IN_PROGRESS');
          deviceEnrollment(this,row.id,binding,device);
        }else row=null;
      }else row=null;
      if(!row){
        row={id:randomUUID(),token:randomBytes(32).toString('hex')};
        this.db.prepare('INSERT INTO passive_enrollments(id,user,token,completed) VALUES(?,?,?,0) ON CONFLICT(user) DO UPDATE SET id=excluded.id,token=excluded.token,completed=0').run(row.id,user,row.token);
        this.db.prepare('INSERT INTO device_enrollments VALUES(?,?,?,?,?)').run(row.id,user,device.id,binding,this.clock()+1800000);
      }
      this.db.exec('COMMIT');
      this.audit(user,'device_enrollment_started',{device:device.id});
      return {deviceOnly:true,activeEnrollment:null,activeComplete:true,passiveEnrollment:{enrollmentId:row.id,enrollmentToken:row.token},...ROUND_REQUIREMENTS,passiveRoundsAccepted:passiveRecords(this,row.id).length};
    }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
  },
  startEnrollmentFlow(user,key){
    this.validUser(user);if(!this.authorized(key))throw Error('ENROLLMENT_UNAUTHORIZED');
    const profile=this.profile(user);if(profile?.passive)throw Error('ALREADY_ENROLLED');
    const active=profile?null:this.start(user,key);
    let passive=this.db.prepare('SELECT * FROM passive_enrollments WHERE user=? AND completed=0').get(user);
    if(!passive){passive={id:randomUUID(),token:randomBytes(32).toString('hex')};this.db.prepare('INSERT INTO passive_enrollments(id,user,token) VALUES(?,?,?)').run(passive.id,user,passive.token);}
    return {activeEnrollment:active,activeComplete:!!profile,passiveEnrollment:{enrollmentId:passive.id,enrollmentToken:passive.token},...ROUND_REQUIREMENTS,passiveRoundsAccepted:passiveRecords(this,passive.id).length};
  },
  passiveChallenge(user,purpose,context={},binding=null,enrollment={}){
    this.validUser(user);
    if(purpose==='passive-enroll'){
      passiveEnrollment(this,user,enrollment.enrollmentId,enrollment.enrollmentToken);
      deviceEnrollment(this,enrollment.enrollmentId,binding,this.device(context));
      if(passiveRecords(this,enrollment.enrollmentId).length>=PASSIVE_ROUNDS_MAXIMUM)throw Error('ENROLLMENT_LIMIT_REACHED');
    }else if(purpose!=='passive-auth'||!this.profile(user))throw Error('PROFILE_NOT_FOUND');
    const c={challengeId:randomUUID(),nonce:randomBytes(24).toString('hex'),userId:user,purpose,device:this.device(context),binding,issuedAt:this.clock(),expiresAt:this.clock()+180000,enrollmentId:purpose==='passive-enroll'?enrollment.enrollmentId:null};
    this.db.prepare('INSERT INTO challenges(id,body) VALUES(?,?)').run(c.challengeId,JSON.stringify(c));return c;
  },
  submitPassive(body,purpose,binding=null,passwordValid=false){
    const start=performance.now();const row=consume(this,body.challengeId);let decided=null,user=null;
    const finish=result=>{if(!result.explanation)annotate(result,{kind:'passive',user},decided??performance.now()-start);result.verificationMs=Number((performance.now()-start).toFixed(3));this.audit(typeof body.userId==='string'?body.userId.slice(0,64):null,'passive_verification',{decision:result.decision,reasons:result.reasons,fraudSignals:result.fraudSignals,latencyMs:result.latencyMs,verificationMs:result.verificationMs});return result;};
    if(!row)return finish(reject('INVALID_CHALLENGE'));if(row.used)return finish(reject('REPLAYED_CHALLENGE'));
    const c=JSON.parse(row.body);user=c.userId;
    if(c.userId!==body.userId||c.nonce!==body.nonce||c.purpose!==purpose||(c.binding&&c.binding!==binding))return finish(reject('CHALLENGE_BINDING_MISMATCH'));
    if(this.clock()>=c.expiresAt)return finish(reject('EXPIRED_CHALLENGE'));
    if(purpose==='passive-enroll'){
      passiveEnrollment(this,c.userId,c.enrollmentId,body.enrollmentToken);
      deviceEnrollment(this,c.enrollmentId,binding,c.device);
    }
    if(body.username!==c.userId)return finish({...reject('USERNAME_MISMATCH'),fresh:true,password:'FAIL'});
    if(purpose==='passive-auth'&&!passwordValid)return finish({...reject('PASSWORD_INCORRECT'),fresh:true,password:'FAIL'});
    const t0=performance.now();
    let a;try{a=analyzePassive(body.events,body.hints);}catch(e){return finish({...reject(e.message),password:purpose==='passive-auth'?'PASS':'TRAINING'});}
    const recent=this.db.prepare('SELECT body FROM passive_replay WHERE user=? ORDER BY id DESC LIMIT 128').all(c.userId).map(r=>JSON.parse(r.body));
    const exact=a.signature&&this.db.prepare('SELECT 1 FROM passive_sessions WHERE signature=?').get(a.signature);
    const near=recent.some(r=>passiveNearReplay(a.fingerprint,r));
    const p=this.profile(c.userId),device=p?.passive?.devices?.[c.device.id];
    const known=device?.status==='trusted'&&device.class===c.device.class;
    const compatible=!!p?.passive&&Object.values(p.passive.devices??{}).some(d=>d.class===c.device.class&&d.status==='trusted');
    const profile=known?device:p?.passive;
    const match=matchPassive(a,compatible?profile:null);
    const bars=passiveBars(compatible?profile:null);
    const threshold=this.options.passiveThreshold??bars.threshold,rejectThreshold=Math.min(bars.rejectThreshold,threshold);
    const ambient=purpose==='passive-auth'&&this.options.ambient!==false?this.ambientEvidence(body.ambientId,c.userId,binding,c.device):null;
    const ambientReplay=!!ambient?.reasons?.includes('AMBIENT_REPLAY');
    const ambientUsable=!!ambient?.usable&&ambient.compatible&&Number.isFinite(ambient.match.score)&&ambient.match.quality>=ambient.qualityMinimum;
    const ambientScore=ambientUsable?ambient.match.score:null;
    const ambientMargin=this.options.ambientMismatchMargin??.1;
    const ambientMismatch=ambientUsable&&(ambientScore<ambient.threshold-ambientMargin||ambient.aggregate.humanScore<ambient.humanMinimum);
    const ambientWeight=ambientUsable?Math.min(this.options.ambientWeight??.2,(this.options.ambientWeight??.2)*Math.min(1,ambient.match.quality)):0;
    const blended=Number.isFinite(match.score)&&ambientUsable?(1-ambientWeight)*match.score+ambientWeight*ambientScore:match.score;
    const ambientMargin_=Number.isFinite(ambientScore)&&Number.isFinite(ambient?.threshold)
      ? Math.max(0,Math.min(1,(ambientScore-ambient.threshold)/Math.max(.05,1-ambient.threshold))) : 0;
    const bonus=this.options.ambientLift===true&&ambientUsable?ambientWeight*ambientMargin_:0;
    const fusedScore=Number.isFinite(match.score)&&ambientUsable
      ? Math.min(1,Math.max(blended,match.score+bonus))
      : match.score;
    const lift=this.options.ambientLift===true;
    const lifted=lift&&Number.isFinite(match.score)&&match.score<threshold&&Number.isFinite(fusedScore)&&fusedScore>=threshold;
    const rescueAttempted=!lift&&Number.isFinite(match.score)&&match.score<threshold&&Number.isFinite(fusedScore)&&fusedScore>=threshold;
    const identityClears=lift
      ? Number.isFinite(fusedScore)&&fusedScore>=threshold
      : match.score!==null&&match.score>=threshold&&fusedScore>=threshold;
    const ambientEvidenceBlock=ambient?{identityScore:ambientScore,lifted,bonus,passiveAlone:match.score??null,rawScore:ambient.match?.score??null,quality:ambient.match?.quality??null,observedQuality:ambient.aggregate?.quality??null,humanScore:ambient.aggregate?.humanScore??null,windows:ambient.windows??0,span:ambient.aggregate?.span??0,threshold:ambient.threshold,compatible:!!ambient.compatible,weight:ambientWeight,used:ambientUsable,modalities:ambient.match?.modalities??{},evidenceQuality:ambient.aggregate?.evidenceQuality??{},availability:ambient.aggregate?.availability??{},signals:ambient.aggregate?.signals??[],reasons:ambient.reasons??[],matcherVersion:ambient.matcherVersion??null}:null;
    const evidence={phase:'passive',ambient:ambientEvidenceBlock,fusedIdentityScore:fusedScore,password:purpose==='passive-auth'?'PASS':'TRAINING',identityScore:match.score,quality:purpose==='passive-enroll'?a.quality:match.quality,observedQuality:a.quality,evidenceQuality:a.evidenceQuality,availability:a.availability,modalities:match.modalities,humanScore:a.humanScore,signals:a.signals,fresh:!exact&&!near,complete:a.complete,
      fusionWeights:Object.fromEntries(Object.entries(PASSIVE_WEIGHTS).map(([m,w])=>[m,w*(a.evidenceQuality?.[m]??0)])),
      ...(this.options.explain?{features:match.features}:{}),provisional:true,threshold,rejectThreshold,modalityThresholds:bars.modalityThresholds,submitMethod:a.submitMethod,qualityMinimum:.75,humanMinimum:.8,deviceState:known?'trusted':'unknown',matcherVersion:PASSIVE_VERSION};
    let result;
    const trainingMinimum=c.device.class==='desktop-pointer'?.75:.1;
    if(exact||near)result={...evidence,decision:'REJECT',allowed:false,reasons:[exact?'EXACT_REPLAY':'NEAR_REPLAY']};
    else if(a.hardAutomation)result={...evidence,decision:'REJECT',allowed:false,reasons:['AUTOMATION_RISK'],hardSignals:a.hardSignals};
    else if(purpose==='passive-auth'&&known&&Number.isFinite(match.score)&&match.score<rejectThreshold&&a.complete&&match.quality>=profile.qualityMinimum)result={...evidence,decision:'REJECT',allowed:false,activeRequired:false,reasons:['IDENTITY_MISMATCH']};
    else if(purpose==='passive-enroll')result={...evidence,trainingMinimum,decision:a.quality>=trainingMinimum&&a.complete&&a.humanScore>=.8?'SAMPLE_ACCEPTED':'MORE_DATA',allowed:false,reasons:a.quality>=trainingMinimum&&a.complete&&a.humanScore>=.8?[]:['INSUFFICIENT_PASSIVE_TRAINING']};
    else if(known&&identityClears&&!ambientMismatch&&!ambientReplay&&match.quality>=profile.qualityMinimum&&a.complete&&a.humanScore>=profile.humanMinimum)result={...evidence,decision:'ACCEPT',allowed:true,reasons:[],activeRequired:false};
    else result={...evidence,decision:'STEP_UP',allowed:false,activeRequired:true,reasons:[...(!p?.passive?['PASSIVE_PROFILE_MISSING']:!known?['NEW_DEVICE']:[]),...(match.quality<.75||!a.complete?['INSUFFICIENT_PASSIVE_EVIDENCE']:[]),...(!identityClears&&Number.isFinite(lift?fusedScore:match.score)?['PASSIVE_IDENTITY_UNCERTAIN']:[]),...(a.humanScore<.8?['PASSIVE_HUMANITY_UNCERTAIN']:[]),...(ambientReplay?['AMBIENT_REPLAY']:[]),...(ambientMismatch?['AMBIENT_IDENTITY_UNCERTAIN']:[]),...(rescueAttempted?['AMBIENT_CANNOT_RESCUE']:[])]};
    decided=performance.now()-t0;
    annotate(result,{kind:'passive',user},decided);
    const sessionId=randomUUID();
    const record={sessionId,recordedAt:this.clock(),challenge:c,events:a.events,hints:{webdriver:body.hints?.webdriver===true},derived:{...a,events:undefined},result,studySessionId:typeof body.studySessionId==='string'?body.studySessionId.slice(0,128):null};
    this.db.prepare('INSERT INTO passive_sessions VALUES(?,?,?,?,?,?)').run(sessionId,c.userId,c.enrollmentId,a.signature,result.decision==='SAMPLE_ACCEPTED'?1:0,JSON.stringify(record));
    if(result.allowed){result.passiveAdaptation=this.quarantinePassive(c.userId,record,true);this.db.prepare('UPDATE passive_sessions SET body=? WHERE id=?').run(JSON.stringify(record),sessionId);}
    if(a.fingerprint){this.db.prepare('INSERT INTO passive_replay(user,body) VALUES(?,?)').run(c.userId,JSON.stringify(a.fingerprint));this.db.prepare('DELETE FROM passive_replay WHERE user=? AND id NOT IN (SELECT id FROM passive_replay WHERE user=? ORDER BY id DESC LIMIT 128)').run(c.userId,c.userId);}
    if(purpose==='passive-enroll'){const records=passiveRecords(this,c.enrollmentId),readiness=passiveReadiness(records);Object.assign(result,{roundsAccepted:records.length,roundsRequired:readiness.roundsRequired,roundsRecommended:PASSIVE_ROUNDS,roundsMaximum:PASSIVE_ROUNDS_MAXIMUM,readyToComplete:readiness.ready,calibrationConsistent:readiness.consistent});}
    else {
      result.loginId=c.challengeId;
      if(ambient?.windowIds?.length)this.consumeAmbient(body.ambientId,c.userId,ambient.windowIds,c.challengeId);
      this.db.prepare('INSERT INTO login_attempts VALUES(?,?,?,?,?,?)').run(c.challengeId,c.userId,binding,c.expiresAt,result.decision==='STEP_UP'?'pending':'finished',JSON.stringify({passive:result,device:c.device,compatible,passiveSessionId:sessionId,ambientReplay}));
    }
    return finish(result);
  },
  completeEnrollmentFlow(user,flow,binding=null){
    const e=flow.passiveEnrollment??{};passiveEnrollment(this,user,e.enrollmentId,e.enrollmentToken);
    const deviceFlow=deviceEnrollment(this,e.enrollmentId,binding);
    const records=passiveRecords(this,e.enrollmentId);if(!passiveReadiness(records).ready)throw Error('MORE_PASSIVE_ENROLLMENT_REQUIRED');
    if(deviceFlow&&records.some(r=>r.challenge.device.id!==deviceFlow.device))throw Error('DEVICE_BINDING_MISMATCH');
    const passive=calibratePassive(records.map(r=>r.derived));
    if(passive.calibration.scores.filter(s=>s<.4).length>records.length/3)throw Error('PASSIVE_ENROLLMENT_INCONSISTENT');
    passive.devices={};
    for(const r of records){const d=r.challenge.device,group=records.filter(x=>x.challenge.device.id===d.id);if(passiveReadiness(group).ready)passive.devices[d.id]={...calibratePassive(group.map(x=>x.derived)),class:d.class,status:'trusted'};}
    if(!Object.keys(passive.devices).length)throw Error('MORE_PASSIVE_DEVICE_ENROLLMENT_REQUIRED');
    if(!this.profile(user)){const active=flow.activeEnrollment??{};this.complete(user,active.enrollmentId,active.enrollmentToken);}
    const p=this.profile(user);
    if(deviceFlow){
      if(!p.passive)throw Error('PASSIVE_PROFILE_REQUIRED');
      if(p.passive.devices?.[deviceFlow.device]?.status==='trusted')throw Error('DEVICE_ALREADY_ENROLLED');
      p.passive.devices={...p.passive.devices,...passive.devices};
    }else{
      if(p.passive)throw Error('ALREADY_ENROLLED');p.passive=passive;p.passiveCreatedAt=this.clock();
    }
    const ambientReport=this.ambientEnrollment(user,flow.ambientId,binding);
    if(ambientReport.enrolled&&!p.ambient)p.ambient=ambientReport.model;
    p.version++;
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE profiles SET body=? WHERE user=?').run(JSON.stringify(p),user);this.db.prepare('UPDATE passive_enrollments SET completed=1,token=NULL WHERE id=?').run(e.enrollmentId);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
    this.audit(user,deviceFlow?'device_enrollment_complete':'combined_enrollment_complete',{passiveRounds:records.length,activeRounds:p.rounds,device:deviceFlow?.device});return {enrolled:true,deviceOnly:!!deviceFlow,passiveRounds:records.length,activeRounds:p.rounds,ambient:{enrolled:!!p.ambient,windows:ambientReport.windows,required:ambientReport.required,reason:ambientReport.reason??null},provisional:true};
  },
  stepUpChallenge(body,binding){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.db.prepare('SELECT * FROM login_attempts WHERE id=?').get(body.loginId??'');
      if(!row||row.binding!==binding||row.user!==body.userId)throw Error('INVALID_LOGIN_BINDING');
      if(row.state!=='pending')throw Error('STEP_UP_ALREADY_USED');if(this.clock()>=row.expires)throw Error('EXPIRED_LOGIN');
      const state=JSON.parse(row.body),device=this.device(body.device);
      if(device.id!==state.device.id||device.class!==state.device.class)throw Error('DEVICE_BINDING_MISMATCH');
      const c=this.challenge(row.user,'auth',undefined,undefined,{...body.device,scroll:false},binding);
      c.loginAttemptId=row.id;c.targets=c.targets.slice(0,4);
      this.db.prepare('UPDATE challenges SET body=? WHERE id=?').run(JSON.stringify(c),c.challengeId);
      state.activeChallengeId=c.challengeId;
      this.db.prepare('UPDATE login_attempts SET state=?,expires=?,body=? WHERE id=?').run('active',c.expiresAt,JSON.stringify(state),row.id);
      this.db.exec('COMMIT');return c;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  },
  finishStepUp(body,binding){
    this.db.exec('BEGIN IMMEDIATE');let row;
    try{
      row=this.db.prepare('SELECT * FROM login_attempts WHERE id=?').get(body.loginId??'');
      if(!row||row.binding!==binding||row.user!==body.userId)throw Error('INVALID_LOGIN_BINDING');
      if(row.state!=='active')throw Error('STEP_UP_ALREADY_USED');
      this.db.prepare("UPDATE login_attempts SET state='finished' WHERE id=?").run(row.id);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    const state=JSON.parse(row.body),passive=state.passive;
    if(this.clock()>=row.expires||state.activeChallengeId!==body.challengeId)return annotate({...reject(this.clock()>=row.expires?'EXPIRED_LOGIN':'CHALLENGE_BINDING_MISMATCH'),phase:'final',passive},{kind:'final',user:row.user},0);
    const t0=performance.now();
    const active=this.submit(body,'auth',binding,{deferAdaptation:true,loginId:row.id});
    const passiveWeight=this.options.passiveWeight??.35;
    const wp=state.compatible&&Number.isFinite(passive.identityScore)?passiveWeight*passive.quality:0,wa=(1-passiveWeight)*(active.quality??0);
    const score=Number.isFinite(active.identityScore)&&wa>0?(wp*(passive.identityScore??0)+wa*active.identityScore)/(wp+wa):null;
    const humanScore=Number.isFinite(active.humanScore)?(wp*passive.humanScore+wa*active.humanScore)/Math.max(.001,wp+wa):0;
    const passiveBar=Number.isFinite(passive.threshold)?passive.threshold:0,activeBar=active.threshold??.75;
    const threshold=this.options.finalThreshold??(wp+wa>0?(wp*passiveBar+wa*activeBar)/(wp+wa):activeBar),fresh=passive.fresh===true&&active.fresh===true&&state.ambientReplay!==true;
    const allowed=active.allowed&&fresh&&active.quality===1&&score>threshold&&humanScore>=.8;
    const result={decision:allowed?'ACCEPT':'REJECT',allowed,phase:'final',password:'PASS',identityScore:score,threshold,quality:active.quality??0,humanScore,fresh,passive,active,activeRequired:true,loginId:row.id,reasons:allowed?[]:active.reasons?.length?active.reasons:humanScore<.8?['AUTOMATION_RISK']:['FINAL_IDENTITY_MISMATCH'],provisional:true,fusionWeights:{passive:wp,active:wa},stageThresholds:{passive:passiveBar,active:activeBar}};
    annotate(result,{kind:'final',user:row.user},performance.now()-t0);
    if(active.sessionId){
      const stored=this.db.prepare('SELECT body FROM sessions WHERE id=?').get(active.sessionId);const record=JSON.parse(stored.body);record.activeResult=record.result;record.result=result;
      if(allowed){const p=this.profile(row.user),d=state.device;if(!p.devices?.[d.id]){p.devices??={};p.devices[d.id]={class:d.class,status:'candidate'};this.db.prepare('UPDATE profiles SET body=? WHERE user=?').run(JSON.stringify(p),row.user);}result.adaptation=this.quarantine(row.user,record);}
      this.db.prepare('UPDATE sessions SET body=? WHERE id=?').run(JSON.stringify(record),active.sessionId);
    }
    if(allowed){
      const raw=this.db.prepare('SELECT body FROM passive_sessions WHERE id=?').get(state.passiveSessionId);
      if(raw)result.passiveAdaptation=this.quarantinePassive(row.user,JSON.parse(raw.body),true);
    }
    this.db.prepare('UPDATE login_attempts SET body=? WHERE id=?').run(JSON.stringify({...state,result}),row.id);
    this.audit(row.user,'login_final',{decision:result.decision,reasons:result.reasons,fraudSignals:result.fraudSignals,latencyMs:result.latencyMs});return result;
  }
};
