import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { analyze, calibrate, similarity, ACTIVE_ROUNDS, ACTIVE_ROUNDS_MAXIMUM } from './scoring.js';
import { annotate } from './explain.js';
import { buildAdvanced, matchAdvanced, MATCHER_VERSION } from './matching/index.js';
import { nearReplay } from './security/replay.js';
import { loginMethods, ROUND_REQUIREMENTS } from './login.js';
import { FEATURE_SCHEMA_VERSION } from './features/index.js';
import { quarantinePassive } from './passive-adaptation.js';
import { analyzePassive, calibratePassive, PASSIVE_ROUNDS_MINIMUM, PASSIVE_SCHEMA_VERSION, PASSIVE_VERSION } from './passive.js';
import { continuousMethods } from './continuous.js';
import { ambientMethods } from './ambient-session.js';
import { AMBIENT_SCHEMA_VERSION, AMBIENT_VERSION, ambientModel, calibrateAmbient } from './ambient.js';

export class BioPrint {
  constructor(path, enrollmentKey, clock=Date.now, options={}) {
    if (!enrollmentKey || enrollmentKey.length < 16) throw Error('Enrollment key requires at least 16 characters');
    this.key=enrollmentKey; this.clock=clock; this.options=options; this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, body TEXT NOT NULL, used INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS enrollments(id TEXT PRIMARY KEY, user TEXT UNIQUE, token TEXT, completed INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS profiles(user TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user TEXT, enrollment TEXT, signature TEXT, trusted INTEGER, body TEXT);
      CREATE INDEX IF NOT EXISTS replay_lookup ON sessions(signature);
      CREATE INDEX IF NOT EXISTS user_sessions ON sessions(user);
      CREATE TABLE IF NOT EXISTS replay_history(id INTEGER PRIMARY KEY, user TEXT, body TEXT);
      CREATE INDEX IF NOT EXISTS replay_user ON replay_history(user,id);
      CREATE TABLE IF NOT EXISTS quarantine(id TEXT PRIMARY KEY,user TEXT,device TEXT,created INTEGER,body TEXT);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,created INTEGER,user TEXT,action TEXT,body TEXT);
      CREATE TABLE IF NOT EXISTS passive_enrollments(id TEXT PRIMARY KEY,user TEXT UNIQUE,token TEXT,completed INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS device_enrollments(id TEXT PRIMARY KEY,user TEXT,device TEXT,binding TEXT,expires INTEGER);
      CREATE TABLE IF NOT EXISTS passive_quarantine(id TEXT PRIMARY KEY,user TEXT,device TEXT,created INTEGER,body TEXT);
      CREATE TABLE IF NOT EXISTS monitor_sessions(id TEXT PRIMARY KEY,user TEXT,binding TEXT,expires INTEGER,state TEXT,body TEXT);
      CREATE TABLE IF NOT EXISTS passive_sessions(id TEXT PRIMARY KEY,user TEXT,enrollment TEXT,signature TEXT,trusted INTEGER,body TEXT);
      CREATE INDEX IF NOT EXISTS passive_signature ON passive_sessions(signature);
      CREATE INDEX IF NOT EXISTS passive_enrollment ON passive_sessions(enrollment,trusted);
      CREATE TABLE IF NOT EXISTS passive_replay(id INTEGER PRIMARY KEY,user TEXT,body TEXT);
      CREATE INDEX IF NOT EXISTS passive_replay_user ON passive_replay(user,id);
      CREATE TABLE IF NOT EXISTS login_attempts(id TEXT PRIMARY KEY,user TEXT,binding TEXT,expires INTEGER,state TEXT,body TEXT);
      CREATE TABLE IF NOT EXISTS ambient_sessions(id TEXT PRIMARY KEY,binding TEXT,device TEXT,class TEXT,user TEXT,created INTEGER,expires INTEGER,state TEXT,nonce TEXT,nonceExpires INTEGER,body TEXT);
      CREATE INDEX IF NOT EXISTS ambient_session_user ON ambient_sessions(user,expires);
      CREATE TABLE IF NOT EXISTS ambient_windows(id TEXT PRIMARY KEY,ambient TEXT,user TEXT,signature TEXT,created INTEGER,trusted INTEGER,consumed INTEGER,body TEXT);
      CREATE INDEX IF NOT EXISTS ambient_window_session ON ambient_windows(ambient,consumed,created);
      CREATE INDEX IF NOT EXISTS ambient_window_signature ON ambient_windows(signature);
      CREATE INDEX IF NOT EXISTS ambient_window_user ON ambient_windows(user,trusted);`);
  }
  close(){this.db.close();}
  users(){return this.db.prepare('SELECT user FROM profiles ORDER BY user').all().map(r=>r.user);}
  deleteUser(user){
    this.validUser(user);
    const tables=['enrollments','profiles','sessions','replay_history','quarantine','audit','passive_enrollments','device_enrollments','passive_quarantine','monitor_sessions','passive_sessions','passive_replay','login_attempts','ambient_sessions','ambient_windows'];
    const profile=!!this.profile(user);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      let rows=0;
      for(const table of tables)rows+=this.db.prepare(`DELETE FROM ${table} WHERE user=?`).run(user).changes;
      rows+=this.db.prepare("DELETE FROM challenges WHERE json_extract(body,'$.userId')=?").run(user).changes;
      this.db.exec('COMMIT');
      this.audit(user,'user_deleted',{profile,rows});
      return {userId:user,deleted:true,profile,rows};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  reset(){
    const tables=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const rows={};
      for(const table of tables)rows[table]=this.db.prepare(`DELETE FROM "${table}"`).run().changes;
      this.db.exec('COMMIT');
      return {reset:true,rows};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  validUser(user){if(typeof user!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(user))throw Error('INVALID_USER');}
  authorized(key){const a=Buffer.from(String(key??'')),b=Buffer.from(this.key);return a.length===b.length&&timingSafeEqual(a,b);}
  start(user,key) {
    this.validUser(user); if(!this.authorized(key))throw Error('ENROLLMENT_UNAUTHORIZED');
    const existing=this.db.prepare('SELECT * FROM enrollments WHERE user=?').get(user);
    if(existing?.completed)throw Error('ALREADY_ENROLLED');
    const counts={roundsRequired:ROUND_REQUIREMENTS.activeRoundsRequired,roundsRecommended:ROUND_REQUIREMENTS.activeRoundsRecommended,roundsMaximum:ROUND_REQUIREMENTS.activeRoundsMaximum};
    if(existing)return {enrollmentId:existing.id,enrollmentToken:existing.token,...counts,roundsAccepted:this.samples(existing.id).length};
    const id=randomUUID(),token=randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO enrollments(id,user,token) VALUES(?,?,?)').run(id,user,token);
    return {enrollmentId:id,enrollmentToken:token,...counts,roundsAccepted:0};
  }
  enrollment(user,id,token){
    const e=this.db.prepare('SELECT * FROM enrollments WHERE id=? AND user=? AND token=? AND completed=0').get(id??'',user,token??'');
    if(!e)throw Error('INVALID_ENROLLMENT'); return e;
  }
  device(context={}){
    if(!context||typeof context!=='object'||Array.isArray(context))throw Error('INVALID_DEVICE');
    const deviceClass=context.class??'desktop-pointer';if(!['desktop-pointer','touch','pen'].includes(deviceClass))throw Error('INVALID_DEVICE');
    if(context.installId!==undefined&&(typeof context.installId!=='string'||context.installId.length>128))throw Error('INVALID_DEVICE');
    return {id:context.installId?createHash('sha256').update(context.installId+'\0'+deviceClass).digest('hex'):'legacy',class:deviceClass,scroll:context.scroll===true};
  }
  audit(user,action,body={}){this.db.prepare('INSERT INTO audit(created,user,action,body) VALUES(?,?,?,?)').run(this.clock(),user,action,JSON.stringify(body));}
  challenge(user,purpose='auth',id,token,context={},binding=null){
    this.validUser(user);
    if(purpose==='enroll')this.enrollment(user,id,token);
    else if(purpose!=='auth'||!this.profile(user))throw Error('PROFILE_NOT_FOUND');
    const phrases=['The silver letters 42','Green river running 73','Bright little forest 26'];
    const device=this.device(context),profile=this.profile(user),known=profile?.devices?.[device.id];
    const bootstrap=purpose==='auth'&&!!profile?.devices&&(!known||known.status!=='trusted'||known.class!==device.class);
    const count=bootstrap?5:3;
    if(purpose==='enroll'&&this.samples(id).length>=ACTIVE_ROUNDS_MAXIMUM)throw Error('ENROLLMENT_LIMIT_REACHED');
    const available=known?.advanced?.exemplars??profile?.advanced?.exemplars??[];
    const learned=[...new Set(available.filter(e=>e.deviceClass===device.class).map(e=>e.phrase))];
    const compatiblePhrases=learned.filter(phrase=>available.filter(e=>e.phrase===phrase&&e.deviceClass===device.class).length>=3);
    const corpus=purpose==='auth'?(this.options.advanced&&compatiblePhrases.length?compatiblePhrases:learned.length?learned:phrases):phrases.slice(0,Math.max(1,Math.floor(ACTIVE_ROUNDS/3)));
    const targets=[];
    for(let i=0;i<count;i++){
      let point;
      for(let attempt=0;attempt<50;attempt++){
        point={x:.14+randomInt(73)/100,y:.15+randomInt(66)/100,radius:(device.class==='desktop-pointer'?50:85)/1000+randomInt(21)/1000};
        if(!targets.length||Math.hypot(point.x-targets.at(-1).x,point.y-targets.at(-1).y)>.25)break;
      }
      targets.push(point);
    }
    const c={challengeId:randomUUID(),nonce:randomBytes(24).toString('hex'),userId:user,purpose,enrollmentId:purpose==='enroll'?id:null,device,bootstrap,binding,phrase:corpus[purpose==='enroll'?this.samples(id).length%corpus.length:randomInt(corpus.length)],targets,scrollTarget:device.scroll ? .25+randomInt(50)/100 : null,issuedAt:this.clock(),expiresAt:this.clock()+180000};
    c.interaction=device.class==='desktop-pointer'?'point':'drag';
    if(c.interaction==='drag')c.dragStart={x:.5,y:.92};
    this.db.prepare('INSERT INTO challenges(id,body) VALUES(?,?)').run(c.challengeId,JSON.stringify(c));return c;
  }
  profile(user){const r=this.db.prepare('SELECT body FROM profiles WHERE user=?').get(user);return r?JSON.parse(r.body):null;}
  enrollmentCounts(){
    const profiles=this.db.prepare('SELECT body FROM profiles').all().map(r=>JSON.parse(r.body));
    return {profiles:profiles.length,
      passive:profiles.filter(p=>!!p.passive).length,
      ambient:profiles.filter(p=>!!p.ambient).length,
      devices:profiles.reduce((sum,p)=>sum+Object.values(p.passive?.devices??{}).filter(d=>d.status==='trusted').length,0),
      provisional:true};
  }
  status(user){this.validUser(user);const p=this.profile(user);return {enrolled:!!p,...ROUND_REQUIREMENTS,passiveEnrolled:!!p?.passive,passiveRounds:p?.passive?.rounds??0,passiveFeatureSchemaVersion:p?.passive?(p.passive.featureSchemaVersion??1):null,passiveMatcherVersion:p?.passive?.matcherVersion??null,passiveMigrationRequired:this.passiveStale(p?.passive),profileVersion:p?.version??null,featureSchemaVersion:p?.featureSchemaVersion??1,matcherVersion:p?.matcherVersion??'baseline-1',matcherMode:this.options.advanced?'advanced':'shadow',trustedDevices:Object.values(p?.devices??{}).filter(d=>d.status==='trusted').length,adaptation:this.options.adaptation?'quarantined':'disabled',passiveAdaptation:this.options.passiveAdaptation?'quarantined':'disabled',loginPolicy:this.options.loginCalibrated?'calibrated':'provisional',ambientEnrolled:!!p?.ambient,ambientWindows:p?.ambient?.windows??0,ambientClass:p?.ambient?.class??null,ambientFeatureSchemaVersion:p?.ambient?.featureSchemaVersion??null,ambientMatcherVersion:p?.ambient?.matcherVersion??null,ambientMigrationRequired:this.ambientStale(p?.ambient),provisional:true};}
  submit(body,purpose,binding=null,options={}){
    const started=performance.now();
    const user=typeof body?.userId==='string'?body.userId.slice(0,64):null;
    try{
      const result=this.verifySubmission(body,purpose,binding,options);
      annotate(result,{kind:'active',user},result.latencyMs??performance.now()-started);
      result.verificationMs=Number((performance.now()-started).toFixed(3));
      this.audit(user,'verification',{decision:result.decision,reasons:result.reasons,fraudSignals:result.fraudSignals,latencyMs:result.latencyMs,verificationMs:result.verificationMs});
      return result;
    }catch(e){this.audit(user,'verification_error',{reason:/^[A-Z_]+$/.test(e.message)?e.message:'INTERNAL_ERROR'});throw e;}
  }
  verifySubmission(body,purpose,binding=null,options={}){
    const started=performance.now();
    const {challengeId,nonce,userId,events}=body;
    if(typeof challengeId!=='string')throw Error('INVALID_CHALLENGE');
    this.db.exec('BEGIN IMMEDIATE');let row;
    try {row=this.db.prepare('SELECT * FROM challenges WHERE id=?').get(challengeId);
      if(row&&!row.used)this.db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(challengeId);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    const reject=reason=>({decision:'REJECT',allowed:false,reasons:[reason]});
    if(!row)return reject('INVALID_CHALLENGE');if(row.used)return reject('REPLAYED_CHALLENGE');
    const c=JSON.parse(row.body);
    if(c.loginAttemptId&&c.loginAttemptId!==options.loginId)return reject('STEP_UP_ENDPOINT_REQUIRED');
    if(c.nonce!==nonce||c.userId!==userId||c.purpose!==purpose||(c.binding&&c.binding!==binding))return reject('CHALLENGE_BINDING_MISMATCH');
    if(this.clock()>=c.expiresAt)return reject('EXPIRED_CHALLENGE');
    if(purpose==='enroll')this.enrollment(userId,c.enrollmentId,body.enrollmentToken);
    const t0=performance.now();
    let a;try{a=analyze(c,events);}catch(e){return reject(e.message);}
    if(this.db.prepare('SELECT 1 FROM sessions WHERE signature=?').get(a.signature))return {...reject('EXACT_REPLAY'),humanScore:a.humanScore,signals:a.humanReasons,fresh:false};
    const recent=this.db.prepare('SELECT body FROM replay_history WHERE user=? ORDER BY id DESC LIMIT 128').all(userId);
    const replay=recent.some(r=>nearReplay(a.replayFingerprint,JSON.parse(r.body)));
    this.db.prepare('INSERT INTO replay_history(user,body) VALUES(?,?)').run(userId,JSON.stringify(a.replayFingerprint));
    this.db.prepare('DELETE FROM replay_history WHERE user=? AND id NOT IN (SELECT id FROM replay_history WHERE user=? ORDER BY id DESC LIMIT 128)').run(userId,userId);
    const evidence={identityScore:null,humanScore:a.humanScore,quality:a.quality,evidenceQuality:a.rich.quality,availability:a.rich.availability,featureSchemaVersion:FEATURE_SCHEMA_VERSION,fresh:!replay,
      ...(this.options.explain?{task:{phrase:c.phrase?.length??null,targets:c.targets?.length??0,scroll:c.scrollTarget!=null}}:{}),provisional:true};
    let result;
    if(replay)result={...evidence,...reject('NEAR_REPLAY')};
    else if(a.quality<1||!a.complete)result={...evidence,decision:'MORE_DATA',allowed:false,reasons:['INSUFFICIENT_EVIDENCE',...(a.rich.timing.coarse?['COARSE_TIMING']:[]),...(a.rich.timing.interrupted?['FOCUS_INTERRUPTED']:[])]};
    else if(a.humanScore<.6)result={...evidence,...reject('AUTOMATION_RISK'),signals:a.humanReasons};
    else if(purpose==='enroll')result={...evidence,decision:'SAMPLE_ACCEPTED',allowed:false,reasons:[]};
    else {const p=this.profile(userId);if(!p)return reject('PROFILE_NOT_FOUND');const device=p.devices?.[c.device?.id],compatible=!p.devices||Object.values(p.devices).some(d=>d.class===(c.device?.class??'desktop-pointer')&&d.status==='trusted');
      const model=device?.status==='trusted'&&device.class===c.device?.class?device:p;
      const s=similarity(a.feature,model),advanced=matchAdvanced(a,c,model.advanced??p.advanced);
      const enabled=this.options.advanced===true,threshold=enabled?this.options.identityThreshold:Math.max(p.threshold,model.threshold);
      const score=enabled?advanced.score:s.score;
      const sufficient=compatible&&(!enabled||advanced.complete)&&(!c.bootstrap||c.targets.length>=(c.loginAttemptId?4:5));
      const allowed=sufficient&&Number.isFinite(score)&&score>threshold;
      result={...evidence,identityScore:score,baselineScore:s.score,threshold,modalities:enabled?advanced.modalities:s.modalities,advanced:{...advanced,mode:enabled?'active':'shadow'},
        ...(this.options.explain?{features:s.features}:{}),
        deviceState:device?.status??'unknown',decision:!sufficient?'MORE_DATA':allowed?'ACCEPT':'REJECT',allowed,reasons:!sufficient?[!compatible?'INCOMPATIBLE_DEVICE_MODALITY':'INSUFFICIENT_COMPATIBLE_EXEMPLARS']:allowed?[]:['IDENTITY_MISMATCH']};}
    result.latencyMs=Number((performance.now()-t0).toFixed(3));
    const sessionId=randomUUID();result.sessionId=sessionId;result.verificationMs=Number((performance.now()-started).toFixed(3));
    const record={sessionId,recordedAt:this.clock(),featureSchemaVersion:FEATURE_SCHEMA_VERSION,matcherVersion:MATCHER_VERSION,calibrationVersion:this.options.advanced?'session-validation-1':'loo-round-2',studySessionId:typeof body.studySessionId==='string'?body.studySessionId.slice(0,128):null,challenge:c,events,derived:a,result};
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(sessionId,userId,c.enrollmentId,a.signature,result.decision==='SAMPLE_ACCEPTED'?1:0,JSON.stringify(record));
    if(result.allowed&&!options.deferAdaptation)result.adaptation=this.quarantine(userId,record);
    if(purpose==='enroll'){const n=this.samples(c.enrollmentId).length;Object.assign(result,{roundsAccepted:n,roundsRequired:ACTIVE_ROUNDS,roundsRecommended:ROUND_REQUIREMENTS.activeRoundsRecommended,roundsMaximum:ACTIVE_ROUNDS_MAXIMUM,readyToComplete:n>=ACTIVE_ROUNDS});}
    return result;
  }
  samples(id){return this.db.prepare('SELECT body FROM sessions WHERE enrollment=? AND trusted=1').all(id).map(r=>JSON.parse(r.body).derived.feature);}
  records(user){return this.db.prepare('SELECT id,body FROM sessions WHERE user=? AND trusted=1 ORDER BY rowid DESC LIMIT 48').all(user).reverse().map(r=>{const record={...JSON.parse(r.body),sessionId:r.id};if(record.derived.rich?.featureSchemaVersion!==FEATURE_SCHEMA_VERSION)record.derived=analyze(record.challenge,record.events);return record;});}
  passiveStale(passive){
    const stale=m=>m.featureSchemaVersion!==PASSIVE_SCHEMA_VERSION||m.matcherVersion!==PASSIVE_VERSION;
    return !!passive&&(stale(passive)||Object.values(passive.devices??{}).some(stale));
  }
  passiveRecords(user,rederive=false){
    return this.db.prepare('SELECT id,enrollment,body FROM passive_sessions WHERE user=? AND trusted=1 ORDER BY rowid').all(user).map(r=>{
      const record={...JSON.parse(r.body),sessionId:r.id,enrollmentId:r.enrollment};
      if(!rederive&&record.derived?.featureSchemaVersion===PASSIVE_SCHEMA_VERSION)return record;
      try{record.derived={...analyzePassive(record.events,record.hints??{}),events:undefined};}catch{return null;}
      return record;
    }).filter(Boolean);
  }
  migratePassive(user,p){
    if(!this.passiveStale(p.passive))return null;
    const records=this.passiveRecords(user,true),enrolled=records.filter(r=>r.enrollmentId);
    const report={shared:'skipped',devices:{},reasons:[]};let applied=false,changed=false;
    const rebuild=(target,samples,extra={})=>{
      const calibrated=calibratePassive(samples.map(r=>r.derived));
      const ruleChanged=target.matcherVersion!==PASSIVE_VERSION||!Number.isFinite(target.rejectThreshold);
      const threshold=ruleChanged?calibrated.threshold:Math.max(target.threshold,calibrated.threshold);
      const moved=JSON.stringify([target.model,target.threshold,target.rejectThreshold])!==JSON.stringify([calibrated.model,threshold,calibrated.rejectThreshold]);
      Object.assign(target,calibrated,{threshold,qualityMinimum:Math.max(target.qualityMinimum??0,calibrated.qualityMinimum),humanMinimum:Math.max(target.humanMinimum??0,calibrated.humanMinimum)},extra);
      applied=true;changed||=moved;return moved?'rebuilt':'stamped';
    };
    const first=enrolled[0]?.enrollmentId,original=first?enrolled.filter(r=>r.enrollmentId===first):[];
    if(original.length<PASSIVE_ROUNDS_MINIMUM)report.reasons.push('INSUFFICIENT_ORIGINAL_ENROLLMENT_RECORDS');
    else if(Number.isFinite(p.passiveCreatedAt)&&!(original[0].recordedAt<=p.passiveCreatedAt))report.reasons.push('ORIGINAL_ENROLLMENT_RECORDS_UNAVAILABLE');
    else report.shared=rebuild(p.passive,original);
    for(const [id,device] of Object.entries(p.passive.devices??{})){
      const training=enrolled.filter(r=>r.challenge.device?.id===id);
      if(training.length<PASSIVE_ROUNDS_MINIMUM){report.devices[id]='skipped';report.reasons.push('INSUFFICIENT_DEVICE_RECORDS:'+id);continue;}
      const anchored=device.anchorModel!==undefined;
      const promoted=anchored?records.filter(r=>!r.enrollmentId&&r.challenge.device?.id===id):[];
      report.devices[id]=rebuild(device,[...training,...promoted],anchored?{anchorModel:calibratePassive(training.map(r=>r.derived)).model}:{});
    }
    if(!applied)return null;
    if(changed)p.version++;
    p.passiveMigratedAt=this.clock();
    return {...report,changed,version:p.version,featureSchemaVersion:PASSIVE_SCHEMA_VERSION,matcherVersion:PASSIVE_VERSION};
  }
  ambientStale(ambient){return !!ambient&&(ambient.featureSchemaVersion!==AMBIENT_SCHEMA_VERSION||ambient.matcherVersion!==AMBIENT_VERSION);}
  migrateAmbient(user,p){
    if(!this.ambientStale(p.ambient))return null;
    const records=this.ambientRecords(user,true);
    if(records.length<p.ambient.windows)return {rebuilt:false,reasons:['INSUFFICIENT_AMBIENT_RECORDS'],windows:records.length};
    const calibrated=calibrateAmbient(records.map(r=>r.derived));
    const threshold=Math.max(p.ambient.threshold,calibrated.threshold);
    const changed=JSON.stringify([p.ambient.model,p.ambient.threshold])!==JSON.stringify([calibrated.model,threshold]);
    p.ambient={...p.ambient,...calibrated,threshold,
      qualityMinimum:Math.max(p.ambient.qualityMinimum??0,calibrated.qualityMinimum),
      humanMinimum:Math.max(p.ambient.humanMinimum??0,calibrated.humanMinimum)};
    if(changed)p.version++;
    p.ambientMigratedAt=this.clock();
    return {rebuilt:true,changed,windows:records.length,version:p.version,featureSchemaVersion:AMBIENT_SCHEMA_VERSION,matcherVersion:AMBIENT_VERSION,reasons:[]};
  }
  migrate(){
    const migrated=[],passive=[],ambient=[];
    for(const row of this.db.prepare('SELECT user,body FROM profiles').all()){
      const p=JSON.parse(row.body);
      const activeStale=p.featureSchemaVersion!==FEATURE_SCHEMA_VERSION||p.matcherVersion!==MATCHER_VERSION;
      if(!activeStale&&!this.passiveStale(p.passive)&&!this.ambientStale(p.ambient))continue;
      let records=[];
      if(activeStale){
        records=this.records(row.user);if(records.length<8)throw Error('MIGRATION_REQUIRES_RAW_ENROLLMENT');
        p.advanced=buildAdvanced(records);p.devices??={legacy:{center:p.center,scale:p.scale,threshold:p.threshold,class:'desktop-pointer',status:'trusted',advanced:p.advanced}};
        for(const [id,device] of Object.entries(p.devices)){
          const local=records.filter(r=>(r.challenge.device?.id??'legacy')===id);
          if(local.length>=3)device.advanced=buildAdvanced(local);
        }
        p.featureSchemaVersion=FEATURE_SCHEMA_VERSION;p.matcherVersion=MATCHER_VERSION;p.calibrationVersion='legacy-preserved-1';p.version++;p.migratedAt=this.clock();
      }
      const passiveReport=this.migratePassive(row.user,p);
      const ambientReport=this.migrateAmbient(row.user,p);
      if(!activeStale&&!passiveReport&&!ambientReport)continue;
      this.db.exec('BEGIN IMMEDIATE');try{for(const r of records){this.db.prepare('UPDATE sessions SET body=? WHERE id=?').run(JSON.stringify({...r,featureSchemaVersion:FEATURE_SCHEMA_VERSION,matcherVersion:MATCHER_VERSION}),r.sessionId);this.db.prepare('INSERT INTO replay_history(user,body) VALUES(?,?)').run(row.user,JSON.stringify(r.derived.replayFingerprint));}if(activeStale)this.db.prepare('DELETE FROM replay_history WHERE user=? AND id NOT IN (SELECT id FROM replay_history WHERE user=? ORDER BY id DESC LIMIT 128)').run(row.user,row.user);this.db.prepare('UPDATE profiles SET body=? WHERE user=?').run(JSON.stringify(p),row.user);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
      if(activeStale){this.audit(row.user,'schema_migration',{version:p.version});migrated.push(row.user);}
      if(passiveReport){this.audit(row.user,'passive_schema_migration',passiveReport);passive.push({user:row.user,...passiveReport});}
      if(ambientReport){this.audit(row.user,'ambient_schema_migration',ambientReport);ambient.push({user:row.user,...ambientReport});}
    }return {migrated,passive,ambient};
  }
  quarantine(user,r){
    if(!this.options.adaptation)return {state:'disabled'};
    const p=this.profile(user),d=r.challenge.device;
    if(!d||r.result.identityScore<r.result.threshold+.5*(1-r.result.threshold)||r.derived.humanScore<.85||r.derived.quality!==1)return {state:'ineligible'};
    const rows=this.db.prepare('SELECT * FROM quarantine WHERE user=? AND device=? ORDER BY created DESC').all(user,d.id);
    if(rows[0]&&this.clock()-rows[0].created<600000)return {state:'waiting',samples:rows.length,reason:'SEPARATE_SESSIONS_REQUIRED'};
    const previous=rows.map(x=>JSON.parse(x.body));
    if(previous.some(x=>similarity(r.derived.feature,{center:x.derived.feature,scale:p.scale}).score<.9))return {state:'inconsistent'};
    this.db.prepare('INSERT INTO quarantine VALUES(?,?,?,?,?)').run(r.sessionId,user,d.id,this.clock(),JSON.stringify(r));
    p.devices??={};if(!p.devices[d.id])p.devices[d.id]={class:d.class,status:'candidate'};
    const batch=[...previous,r];
    if(batch.length>=4){
      const baseline=this.records(user).filter(x=>(x.challenge.device?.id??'legacy')===d.id);
      const combined=[...baseline,...batch].slice(-24),calibration=calibrate(combined.map(x=>x.derived.feature));
      p.devices[d.id]={...calibration,threshold:Math.max(p.threshold,calibration.threshold),class:d.class,status:'trusted',advanced:buildAdvanced(combined),promotedAt:this.clock()};p.version++;
      this.db.exec('BEGIN IMMEDIATE');try{for(const x of batch)this.db.prepare('UPDATE sessions SET trusted=1 WHERE id=?').run(x.sessionId);this.db.prepare('DELETE FROM quarantine WHERE user=? AND device=?').run(user,d.id);this.db.prepare('UPDATE profiles SET body=? WHERE user=?').run(JSON.stringify(p),user);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
      this.audit(user,'profile_promotion',{device:d.id,samples:batch.length,version:p.version});return {state:'promoted',samples:batch.length};
    }
    this.db.prepare('UPDATE profiles SET body=? WHERE user=?').run(JSON.stringify(p),user);return {state:'quarantined',samples:batch.length,required:4};
  }
  complete(user,id,token){
    this.enrollment(user,id,token);const samples=this.samples(id);if(samples.length<ACTIVE_ROUNDS)throw Error('MORE_ENROLLMENT_REQUIRED');
    if(samples.length>ACTIVE_ROUNDS_MAXIMUM)throw Error('ENROLLMENT_LIMIT_REACHED');
    const baseline=calibrate(samples);
    if(baseline.calibration.scores.filter(s=>s<.25).length>samples.length/4)throw Error('ENROLLMENT_INCONSISTENT');
    const records=this.records(user),devices={};
    for(const r of records){const d=r.challenge.device??{id:'legacy',class:'desktop-pointer'};const group=records.filter(x=>(x.challenge.device?.id??'legacy')===d.id);if(group.length>=3)devices[d.id]={...calibrate(group.map(x=>x.derived.feature)),class:d.class,status:'trusted',advanced:buildAdvanced(group)};}
    const p={...baseline,advanced:buildAdvanced(records),devices,featureSchemaVersion:FEATURE_SCHEMA_VERSION,matcherVersion:MATCHER_VERSION,calibrationVersion:'loo-round-2',version:2,createdAt:this.clock(),rounds:samples.length};
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO profiles VALUES(?,?)').run(user,JSON.stringify(p));this.db.prepare('UPDATE enrollments SET completed=1, token=NULL WHERE id=?').run(id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
    this.audit(user,'enrollment_complete',{rounds:samples.length,version:p.version});
    return {enrolled:true,rounds:samples.length,provisional:true,featureSchemaVersion:FEATURE_SCHEMA_VERSION};
  }
}
Object.assign(BioPrint.prototype,loginMethods);
Object.assign(BioPrint.prototype,{quarantinePassive});
Object.assign(BioPrint.prototype,continuousMethods);
Object.assign(BioPrint.prototype,ambientMethods);
