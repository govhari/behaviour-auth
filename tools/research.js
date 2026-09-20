import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync, createCipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { evaluate } from '../server/evaluation.js';
import { evaluateLogin } from '../server/login-evaluation.js';
import { loadPolicy } from '../server/policy.js';
import { BioPrint } from '../server/core.js';
import { LOCAL_ENROLLMENT_KEY } from '../client/local-demo.js';
const [command,path]=process.argv.slice(2);
try{
  if(command==='evaluate')console.log(JSON.stringify(evaluate(JSON.parse(readFileSync(path,'utf8'))),null,2));
  else if(command==='evaluate-login')console.log(JSON.stringify(evaluateLogin(JSON.parse(readFileSync(path,'utf8')),process.argv[4]?loadPolicy(process.argv[4]):{}),null,2));
  else if(command==='check-policy')console.log(JSON.stringify(loadPolicy(path),null,2));
  else if(['export','export-passive','export-login'].includes(command)){
    const db=new DatabaseSync(path,{readOnly:true});
    const tables=command==='export-login'?['passive_sessions','sessions']:[command==='export-passive'?'passive_sessions':'sessions'];
    const ambientRecords=command==='export-login'&&db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ambient_windows'").get()
      ? db.prepare('SELECT id,ambient,user,created,trusted,body FROM ambient_windows ORDER BY rowid').all().map(row=>{const r=JSON.parse(row.body);
          return {id:row.id,phase:'ambient',ambientSessionId:row.ambient,loginId:r.loginId??null,subjectId:null,claimedUserId:row.user,studySessionId:r.studySessionId??null,
            split:null,attack:null,trained:row.trusted===1,replayed:r.replayed===true,recordedAt:r.recordedAt??row.created,device:r.device,hints:r.hints??{},events:r.events};})
      : [];
    const records=tables.flatMap(table=>db.prepare('SELECT id,user,body FROM '+table+' ORDER BY rowid').all().map(row=>{const r=JSON.parse(row.body);const {nonce,binding,...challenge}=r.challenge;return {id:row.id,phase:table==='passive_sessions'?'passive':'active',loginId:r.challenge.loginAttemptId??(r.challenge.purpose==='passive-auth'?r.challenge.challengeId:null),subjectId:null,claimedUserId:row.user,studySessionId:r.studySessionId??null,split:null,attack:null,protocolValid:null,passwordValid:null,recordedAt:r.recordedAt??null,challenge,events:r.events,...(table==='passive_sessions'?{hints:r.hints??{webdriver:r.derived?.signals?.includes('WEBDRIVER_HINT')??false}}:{})};})).concat(ambientRecords).sort((a,b)=>a.recordedAt-b.recordedAt);db.close();
    console.log(JSON.stringify({schemaVersion:1,mode:command==='export-login'?'login':command==='export-passive'?'passive':'active',origin:'recorded',records},null,2));
  }else if(command==='export-ambient'){
    const db=new DatabaseSync(path,{readOnly:true});
    const records=db.prepare('SELECT id,ambient,user,created,trusted,consumed,body FROM ambient_windows ORDER BY rowid').all().map(row=>{
      const r=JSON.parse(row.body);
      return {id:row.id,phase:'ambient',ambientSessionId:row.ambient,subjectId:null,claimedUserId:row.user,studySessionId:r.studySessionId??null,
        split:null,attack:null,trained:row.trusted===1,consumed:row.consumed===1,replayed:r.replayed===true,
        recordedAt:r.recordedAt??row.created,device:r.device,hints:r.hints??{},events:r.events};
    });
    db.close();
    console.log(JSON.stringify({schemaVersion:1,mode:'ambient',origin:'recorded',records},null,2));
  }else if(command==='audit'){
    const db=new DatabaseSync(path,{readOnly:true});console.log(JSON.stringify(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all(),null,2));db.close();
  }else if(command==='migrate'){
    const core=new BioPrint(path,LOCAL_ENROLLMENT_KEY);try{console.log(JSON.stringify(core.migrate(),null,2));}finally{core.close();}
  }else if(command==='archive'){
    const destination=process.argv[4],passphrase=process.env.BIOPRINT_ARCHIVE_PASSPHRASE;
    if(!destination||!passphrase||passphrase.length<16)throw Error('archive requires an output path and BIOPRINT_ARCHIVE_PASSPHRASE (at least 16 characters)');
    const db=new DatabaseSync(path,{readOnly:true});
    db.exec('BEGIN');let snapshot;try{const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));snapshot=Object.fromEntries(['profiles','sessions','challenges','enrollments','replay_history','quarantine','audit','passive_enrollments','passive_sessions','passive_replay','login_attempts','device_enrollments','passive_quarantine','monitor_sessions','ambient_sessions','ambient_windows'].filter(table=>existing.has(table)).map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));db.exec('COMMIT');}finally{db.close();}
    const salt=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',scryptSync(passphrase,salt,32),iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(snapshot)),cipher.final()]);
    writeFileSync(destination,JSON.stringify({format:'bioprint-archive-1',cipher:'aes-256-gcm',kdf:'scrypt',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{flag:'wx',mode:0o600});console.log('Encrypted snapshot created. Existing files are never overwritten.');
  }else if(command==='prune'){
    const days=Number(process.argv[4]),apply=process.argv[5]==='--apply';if(!Number.isInteger(days)||days<1)throw Error('prune requires a retention period in whole days (minimum 1)');
    const db=new DatabaseSync(path,{readOnly:!apply}),cutoff=Date.now()-days*86400000;
    const targets={sessions:"trusted=0 AND COALESCE(json_extract(body,'$.recordedAt'),json_extract(body,'$.challenge.issuedAt')) < ? AND id NOT IN (SELECT id FROM quarantine)",challenges:"json_extract(body,'$.expiresAt') < ?",audit:'created < ?',quarantine:'created < ?'};
    const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(existing.has('passive_sessions'))targets.passive_sessions="trusted=0 AND json_extract(body,'$.recordedAt') < ?";
    if(existing.has('login_attempts'))targets.login_attempts='expires < ?';
    if(existing.has('passive_quarantine')){targets.passive_quarantine='created < ?';targets.passive_sessions+=" AND id NOT IN (SELECT id FROM passive_quarantine)";}
    if(existing.has('monitor_sessions'))targets.monitor_sessions='expires < ?';
    if(existing.has('ambient_windows'))targets.ambient_windows='trusted=0 AND created < ?';
    if(existing.has('ambient_sessions'))targets.ambient_sessions='user IS NULL AND expires < ?';
    const counts={};db.exec(apply?'BEGIN IMMEDIATE':'BEGIN');try{for(const [table,where] of Object.entries(targets)){counts[table]=db.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+where).get(cutoff).n;if(apply)db.prepare('DELETE FROM '+table+' WHERE '+where).run(cutoff);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
    console.log(JSON.stringify({applied:apply,days,counts,note:'Trusted raw sessions and bounded replay fingerprints are retained. Deleted data is recoverable only from an archive. Re-run with --apply to delete.'},null,2));
  }else throw Error('Usage: node tools/research.js evaluate dataset.json | evaluate-login dataset.json [active-policy.json] | check-policy policy.json | export database.sqlite | export-passive database.sqlite | export-login database.sqlite | export-ambient database.sqlite | audit database.sqlite | migrate database.sqlite | archive database.sqlite output.json | prune database.sqlite days [--apply]');
}catch(e){console.error(e.message);process.exitCode=1;}
