import { randomUUID, randomBytes } from 'node:crypto';
import { analyzeAmbient, aggregateAmbient, matchAmbient, calibrateAmbient, ambientNearReplay,
  AMBIENT_WINDOW_MS, AMBIENT_MIN_WINDOWS, AMBIENT_VERSION, AMBIENT_SCHEMA_VERSION } from './ambient.js';

export const AMBIENT_SESSION_MS = 1800000;
export const AMBIENT_MAX_LIFETIME_MS = 7200000;
export const AMBIENT_MAX_WINDOWS = 60;
export const AMBIENT_EVIDENCE_MS = 900000;
export const AMBIENT_TRAINING_QUALITY = .25;
export const AMBIENT_NONCE_MS = Math.max(90000, AMBIENT_WINDOW_MS * 3);

function ambientSession(core,id,binding){
  if(typeof id!=='string'||!id)return null;
  const row=core.db.prepare('SELECT * FROM ambient_sessions WHERE id=?').get(id);
  if(!row)throw Error('INVALID_AMBIENT_SESSION');
  if(row.binding!==binding)throw Error('AMBIENT_BINDING_MISMATCH');
  return row;
}

export const ambientMethods = {
  startAmbient(body={},binding=null){
    const device=this.device(body.device??{}),now=this.clock();
    const id=randomUUID(),nonce=randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO ambient_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,binding,device.id,device.class,null,now,now+AMBIENT_SESSION_MS,'active',nonce,now+AMBIENT_NONCE_MS,JSON.stringify({windows:0,replay:[]}));
    return {ambientId:id,nonce,windowMs:AMBIENT_WINDOW_MS,expiresAt:now+AMBIENT_SESSION_MS,maxWindows:AMBIENT_MAX_WINDOWS,provisional:true};
  },
  ingestAmbient(body,binding=null){
    const row=ambientSession(this,body.ambientId,binding),now=this.clock();
    if(!row)throw Error('INVALID_AMBIENT_SESSION');
    if(row.state!=='active'||now>=row.expires||now>=row.created+AMBIENT_MAX_LIFETIME_MS){
      this.db.prepare("UPDATE ambient_sessions SET state='expired' WHERE id=?").run(row.id);throw Error('EXPIRED_AMBIENT_SESSION');
    }
    if(row.nonce!==body.nonce||now>=row.nonceExpires)throw Error('INVALID_AMBIENT_WINDOW');
    const state=JSON.parse(row.body);
    if(state.windows>=AMBIENT_MAX_WINDOWS)throw Error('AMBIENT_LIMIT_REACHED');
    const nonce=randomBytes(24).toString('hex');
    this.db.prepare('UPDATE ambient_sessions SET nonce=?,nonceExpires=?,expires=? WHERE id=?')
      .run(nonce,now+AMBIENT_NONCE_MS,Math.min(now+AMBIENT_SESSION_MS,row.created+AMBIENT_MAX_LIFETIME_MS),row.id);
    let a;
    try{a=analyzeAmbient(body.events,body.hints);}
    catch(e){return {accepted:false,nonce,windows:state.windows,reasons:[/^[A-Z_]+$/.test(e.message)?e.message:'INVALID_EVENTS'],provisional:true};}
    const exact=a.signature&&this.db.prepare('SELECT 1 FROM ambient_windows WHERE signature=?').get(a.signature);
    const near=(state.replay??[]).some(f=>ambientNearReplay(a.fingerprint,f));
    const replayed=!!(exact||near);
    const windowId=randomUUID();
    const record={windowId,recordedAt:now,device:{id:row.device,class:row.class},hints:{webdriver:body.hints?.webdriver===true},
      derived:{...a,events:undefined},events:a.events,replayed,studySessionId:typeof body.studySessionId==='string'?body.studySessionId.slice(0,128):null};
    state.windows++;
    if(a.fingerprint)state.replay=[...(state.replay??[]),a.fingerprint].slice(-32);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT INTO ambient_windows VALUES(?,?,?,?,?,?,?,?)').run(windowId,row.id,row.user,a.signature,now,0,0,JSON.stringify(record));
      this.db.prepare('UPDATE ambient_sessions SET body=? WHERE id=?').run(JSON.stringify(state),row.id);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return {accepted:!replayed,nonce,windows:state.windows,quality:a.quality,humanScore:a.humanScore,
      availability:a.availability,reasons:replayed?[exact?'AMBIENT_EXACT_REPLAY':'AMBIENT_NEAR_REPLAY']:[],provisional:true};
  },
  stopAmbient(body,binding=null){
    const row=ambientSession(this,body.ambientId,binding);
    if(row)this.db.prepare("UPDATE ambient_sessions SET state='stopped' WHERE id=?").run(row.id);
    return {stopped:true};
  },
  ambientEvidence(ambientId,user,binding,device){
    if(typeof ambientId!=='string'||!ambientId)return null;
    let row;
    try{row=ambientSession(this,ambientId,binding);}catch(e){return {reasons:[e.message],usable:false};}
    if(!row)return null;
    if(row.device!==device.id||row.class!==device.class)return {reasons:['AMBIENT_DEVICE_MISMATCH'],usable:false};
    if(row.user&&row.user!==user)return {reasons:['AMBIENT_IDENTITY_CONFLICT'],usable:false};
    const now=this.clock();
    const rows=this.db.prepare('SELECT id,body FROM ambient_windows WHERE ambient=? AND consumed=0 AND trusted=0 AND created>=? ORDER BY id').all(ambientId,now-AMBIENT_EVIDENCE_MS);
    const all=rows.map(r=>({id:r.id,...JSON.parse(r.body)}));
    const replayed=all.filter(w=>w.replayed);
    const usableWindows=all.filter(w=>!w.replayed);
    if(!usableWindows.length)return {reasons:[replayed.length?'AMBIENT_REPLAY':'AMBIENT_EVIDENCE_ABSENT'],usable:false,replayed:replayed.length,windowIds:all.map(w=>w.id)};
    const aggregate=aggregateAmbient(usableWindows.map(w=>w.derived));
    const profile=this.profile(user)?.ambient;
    const compatible=!!profile&&profile.class===device.class;
    const match=matchAmbient(aggregate,compatible?profile:null);
    return {
      aggregate,match,usable:true,windowIds:all.map(w=>w.id),replayed:replayed.length,
      windows:usableWindows.length,compatible,
      threshold:this.options.ambientThreshold??profile?.threshold??.6,
      qualityMinimum:profile?.qualityMinimum??.35,humanMinimum:profile?.humanMinimum??.7,
      reasons:[...(replayed.length?['AMBIENT_REPLAY']:[]),...(profile?compatible?[]:['AMBIENT_DEVICE_CLASS_UNTRAINED']:['AMBIENT_PROFILE_MISSING'])],
      matcherVersion:AMBIENT_VERSION,
    };
  },
  consumeAmbient(ambientId,user,windowIds=[],loginId=null){
    if(!ambientId)return;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const id of windowIds){
        const row=this.db.prepare('SELECT body FROM ambient_windows WHERE id=?').get(id);
        if(!row)continue;
        this.db.prepare('UPDATE ambient_windows SET consumed=1,user=?,body=? WHERE id=?').run(user,JSON.stringify({...JSON.parse(row.body),loginId}),id);
      }
      this.db.prepare('UPDATE ambient_sessions SET user=? WHERE id=? AND user IS NULL').run(user,ambientId);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  },
  ambientEnrollment(user,ambientId,binding){
    if(typeof ambientId!=='string'||!ambientId)return {enrolled:false,reason:'AMBIENT_SESSION_ABSENT',windows:0,required:AMBIENT_MIN_WINDOWS};
    let row;
    try{row=ambientSession(this,ambientId,binding);}catch(e){return {enrolled:false,reason:e.message,windows:0,required:AMBIENT_MIN_WINDOWS};}
    if(row.user&&row.user!==user)return {enrolled:false,reason:'AMBIENT_IDENTITY_CONFLICT',windows:0,required:AMBIENT_MIN_WINDOWS};
    const windows=this.db.prepare('SELECT id,body FROM ambient_windows WHERE ambient=? ORDER BY id').all(row.id).map(r=>({id:r.id,...JSON.parse(r.body)}));
    const usable=windows.filter(w=>!w.replayed&&w.derived.quality>=AMBIENT_TRAINING_QUALITY&&w.derived.humanScore>=.7&&!w.derived.hardAutomation);
    if(usable.length<AMBIENT_MIN_WINDOWS)return {enrolled:false,reason:'INSUFFICIENT_AMBIENT_WINDOWS',windows:usable.length,required:AMBIENT_MIN_WINDOWS};
    const calibrated=calibrateAmbient(usable.map(w=>w.derived));
    for(const w of usable)this.db.prepare('UPDATE ambient_windows SET trusted=1,user=? WHERE id=?').run(user,w.id);
    this.db.prepare('UPDATE ambient_sessions SET user=? WHERE id=?').run(user,row.id);
    return {enrolled:true,windows:usable.length,required:AMBIENT_MIN_WINDOWS,
      model:{...calibrated,class:row.class,device:row.device,createdAt:this.clock()}};
  },
  ambientRecords(user,rederive=false){
    return this.db.prepare('SELECT id,ambient,body FROM ambient_windows WHERE user=? AND trusted=1 ORDER BY id').all(user).map(r=>{
      const record={...JSON.parse(r.body),windowId:r.id,ambientId:r.ambient};
      if(!rederive&&record.derived?.featureSchemaVersion===AMBIENT_SCHEMA_VERSION)return record;
      try{record.derived={...analyzeAmbient(record.events,record.hints??{}),events:undefined};}catch{return null;}
      return record;
    }).filter(Boolean);
  },
  pruneAmbient(){
    const now=this.clock();
    const stale=this.db.prepare("SELECT id FROM ambient_sessions WHERE user IS NULL AND (expires<? OR created<?)").all(now-AMBIENT_EVIDENCE_MS,now-AMBIENT_MAX_LIFETIME_MS).map(r=>r.id);
    for(const id of stale){
      this.db.prepare('DELETE FROM ambient_windows WHERE ambient=? AND trusted=0').run(id);
      this.db.prepare('DELETE FROM ambient_sessions WHERE id=?').run(id);
    }
    return {removed:stale.length};
  },
};
