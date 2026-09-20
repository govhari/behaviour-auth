import { randomUUID, randomBytes } from 'node:crypto';
import { analyzeAmbient, matchAmbient, ambientNearReplay, AMBIENT_VERSION } from './ambient.js';
import { annotate } from './explain.js';

export const MONITOR_TTL_MS = 900000;
export const MONITOR_MAX_TTL_MS = 3600000;
export const MONITOR_IDLE_MS = 300000;
export const MONITOR_WINDOW_MS = 30000;

export const analyzeContinuous = analyzeAmbient;

function session(core,id,user,binding){
  const row=core.db.prepare('SELECT * FROM monitor_sessions WHERE id=? AND user=?').get(id??'',user??'');
  if(!row||row.binding!==binding)throw Error('INVALID_MONITOR_SESSION');
  if(row.state!=='active')throw Error('REAUTHENTICATION_REQUIRED');
  if(core.clock()>=row.expires){core.db.prepare("UPDATE monitor_sessions SET state='expired' WHERE id=?").run(row.id);throw Error('EXPIRED_MONITOR_SESSION');}
  return row;
}

export const continuousMethods={
  startMonitoring(body,binding){
    const login=this.db.prepare('SELECT * FROM login_attempts WHERE id=? AND user=?').get(body.loginId??'',body.userId??'');
    if(!login||login.binding!==binding||login.state!=='finished'||this.clock()>=login.expires)throw Error('RECENT_LOGIN_REQUIRED');
    const state=JSON.parse(login.body),accepted=state.result??state.passive;
    if(!accepted?.allowed)throw Error('RECENT_LOGIN_REQUIRED');
    const device=this.device(body.device);
    if(device.id!==state.device.id||device.class!==state.device.class)throw Error('DEVICE_BINDING_MISMATCH');
    if(this.db.prepare('SELECT 1 FROM monitor_sessions WHERE id=?').get(login.id))throw Error('MONITOR_ALREADY_STARTED');
    const now=this.clock(),ttl=this.options.monitorTtlMs??MONITOR_TTL_MS;
    this.db.prepare('INSERT INTO monitor_sessions VALUES(?,?,?,?,?,?)')
      .run(login.id,login.user,binding,now+ttl,'active',JSON.stringify({device:state.device,mismatches:0,lastStrong:now,history:[],challengeId:null,started:now,renewals:0}));
    this.audit(login.user,'monitor_started');
    return {monitorId:login.id,expiresAt:now+ttl,windowMs:MONITOR_WINDOW_MS,maxExpiresAt:now+(this.options.monitorMaxTtlMs??MONITOR_MAX_TTL_MS),provisional:true};
  },
  monitorChallenge(body,binding){
    const row=session(this,body.monitorId,body.userId,binding),state=JSON.parse(row.body);
    if(state.challengeId){const old=this.db.prepare('SELECT used FROM challenges WHERE id=?').get(state.challengeId);if(old&&!old.used)throw Error('MONITOR_WINDOW_PENDING');}
    const c={challengeId:randomUUID(),nonce:randomBytes(24).toString('hex'),userId:row.user,purpose:'continuous',monitorId:row.id,binding,issuedAt:this.clock(),expiresAt:Math.min(row.expires,this.clock()+45000)};
    this.db.prepare('INSERT INTO challenges(id,body) VALUES(?,?)').run(c.challengeId,JSON.stringify(c));state.challengeId=c.challengeId;
    this.db.prepare('UPDATE monitor_sessions SET body=? WHERE id=?').run(JSON.stringify(state),row.id);return c;
  },
  submitMonitor(body,binding){
    const row=session(this,body.monitorId,body.userId,binding),state=JSON.parse(row.body),now=this.clock();
    const t0=performance.now();
    const fail=(reason,extra={})=>{this.db.prepare("UPDATE monitor_sessions SET state='reauthentication' WHERE id=?").run(row.id);this.audit(row.user,'monitor_reauthentication',{reason});return annotate({decision:'REJECT',allowed:false,reauthenticationRequired:true,reasons:[reason],fresh:reason!=='REPLAYED_WINDOW',...extra,provisional:true},{kind:'monitor',user:row.user},performance.now()-t0);};
    const stored=this.db.prepare('SELECT * FROM challenges WHERE id=?').get(body.challengeId??'');
    if(!stored||stored.used)return fail('INVALID_OR_REUSED_WINDOW');
    const c=JSON.parse(stored.body);
    if(c.purpose!=='continuous'||c.monitorId!==row.id||state.challengeId!==c.challengeId||c.nonce!==body.nonce||c.binding!==binding)return fail('WINDOW_BINDING_MISMATCH');
    if(this.db.prepare('UPDATE challenges SET used=1 WHERE id=? AND used=0').run(c.challengeId).changes!==1)return fail('INVALID_OR_REUSED_WINDOW');
    if(now>=c.expiresAt)return fail('EXPIRED_WINDOW');
    let a;try{a=analyzeAmbient(body.events,body.hints);}catch(e){return fail(/^[A-Z_]+$/.test(e.message)?e.message:'INVALID_EVENTS');}
    if(a.signature&&state.history.some(h=>h.signature===a.signature||ambientNearReplay(a.fingerprint,h.fingerprint)))return fail('REPLAYED_WINDOW');
    if(a.signature)state.history=[...state.history,{signature:a.signature,fingerprint:a.fingerprint}].slice(-32);
    if(a.hardAutomation)return fail('AUTOMATION_RISK',{humanScore:a.humanScore,signals:a.signals,hardSignals:a.hardSignals??[]});
    const ambient=this.profile(row.user)?.ambient;
    const compatible=!!ambient&&ambient.class===state.device.class;
    const match=matchAmbient(a,compatible?ambient:null);
    const threshold=this.options.ambientThreshold??ambient?.threshold??.6;
    const qualityMinimum=ambient?.qualityMinimum??.35,humanMinimum=ambient?.humanMinimum??.7;
    const enough=compatible&&Number.isFinite(match.score)&&match.quality>=qualityMinimum;
    const maxExpires=state.started+(this.options.monitorMaxTtlMs??MONITOR_MAX_TTL_MS);
    let expires=row.expires;
    if(enough){
      if(match.score<threshold-(this.options.ambientMismatchMargin??.1)||a.humanScore<humanMinimum)state.mismatches++;
      else{
        state.mismatches=0;state.lastStrong=now;
        const renewed=Math.min(now+(this.options.monitorTtlMs??MONITOR_TTL_MS),maxExpires);
        if(renewed>expires){expires=renewed;state.renewals++;}
      }
    }
    const stale=compatible&&now-state.lastStrong>=(this.options.monitorIdleMs??MONITOR_IDLE_MS);
    const reauthenticate=state.mismatches>=3||stale||now>=maxExpires;
    const result={decision:reauthenticate?'STEP_UP':enough?'OBSERVE':'MORE_DATA',allowed:false,reauthenticationRequired:reauthenticate,
      identityScore:enough?match.score:null,quality:match.quality,observedQuality:a.quality,humanScore:a.humanScore,threshold,
      modalities:match.modalities,evidenceQuality:a.evidenceQuality,availability:a.availability,fresh:true,signals:a.signals,
      windows:state.history.length,expiresAt:expires,renewals:state.renewals,matcherVersion:AMBIENT_VERSION,
      reasons:reauthenticate?['FRESH_LOGIN_REQUIRED']:enough?[]:[compatible?'INSUFFICIENT_CONTINUOUS_EVIDENCE':'AMBIENT_PROFILE_MISSING'],provisional:true};
    annotate(result,{kind:'monitor',user:row.user},performance.now()-t0);
    this.db.prepare('UPDATE monitor_sessions SET state=?,expires=?,body=? WHERE id=?').run(reauthenticate?'reauthentication':'active',expires,JSON.stringify(state),row.id);
    this.audit(row.user,'monitor_window',{decision:result.decision,identityScore:result.identityScore,quality:result.quality,humanScore:result.humanScore,renewals:state.renewals});
    return result;
  },
  stopMonitoring(body,binding){
    const row=this.db.prepare('SELECT * FROM monitor_sessions WHERE id=? AND user=?').get(body.monitorId??'',body.userId??'');
    if(!row||row.binding!==binding)throw Error('INVALID_MONITOR_SESSION');
    this.db.prepare("UPDATE monitor_sessions SET state='stopped' WHERE id=?").run(row.id);return {stopped:true};
  }
};
