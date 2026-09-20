import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BioPrint } from '../server/core.js';
import { makeServer } from '../server/http.js';
import { createDemoAccounts, demoAccountsPath } from '../server/demo-accounts.js';
import { PASSIVE_ROUNDS } from '../server/passive.js';
import { trace, payload } from './fixtures.js';
import { passiveTrace } from './passive-fixtures.js';

const KEY='test-enrollment-secret',BIND='binding-1';
const DEVICE={installId:'install-1',class:'desktop-pointer',scroll:false};
const OWNER={dwell:95,flight:165,pdwell:88,pflight:158,move:17,bow:.09};

function enroll(core,user,now){
  const flow=core.startEnrollmentFlow(user,KEY);
  for(let i=0;i<8;i++){
    const c=core.challenge(user,'enroll',flow.activeEnrollment.enrollmentId,flow.activeEnrollment.enrollmentToken,DEVICE,BIND);
    assert.equal(core.submit({...payload(c,trace(c,{seed:i})),enrollmentToken:flow.activeEnrollment.enrollmentToken},'enroll',BIND).decision,'SAMPLE_ACCEPTED');
    now.t+=45000;
  }
  for(let i=0;i<PASSIVE_ROUNDS;i++){
    const c=core.passiveChallenge(user,'passive-enroll',DEVICE,BIND,flow.passiveEnrollment);
    assert.equal(core.submitPassive({challengeId:c.challengeId,nonce:c.nonce,userId:user,username:user,events:passiveTrace({user,seed:50+i,p:OWNER}),enrollmentToken:flow.passiveEnrollment.enrollmentToken,hints:{}},'passive-enroll',BIND).decision,'SAMPLE_ACCEPTED');
    now.t+=45000;
  }
  assert.equal(core.completeEnrollmentFlow(user,flow,BIND).enrolled,true);
}

async function serve(t,{demo=true}={}){
  const now={t:Date.now()};
  const core=new BioPrint(':memory:',KEY,()=>now.t),accounts=demo?createDemoAccounts(':memory:'):null;
  const server=makeServer(core,{serveDemo:true,...(accounts?{demoAccounts:accounts}:{})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(()=>{core.close();accounts?.close();r();})));
  const base=`http://127.0.0.1:${server.address().port}`,jar=new Map();
  const call=async(path,body)=>{
    const cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; '),csrf=jar.get('bioprint_csrf');
    const res=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-bioprint-csrf':csrf}:{})},body:body?JSON.stringify(body):undefined});
    for(const c of res.headers.getSetCookie()){const [pair]=c.split(';');const i=pair.indexOf('=');jar.set(pair.slice(0,i).trim(),pair.slice(i+1));}
    return {status:res.status,body:await res.json()};
  };
  return {core,accounts,call,now};
}

test('demo accounts: each user chooses a password, and register is idempotent only for its owner',async t=>{
  const {call,accounts}=await serve(t);
  let r=await call('/bioprint/demo/register',{userId:'alice',password:'correct-horse'});
  assert.equal(r.status,200);assert.equal(r.body.created,true);assert.equal(r.body.passiveEnrolled,false);
  r=await call('/bioprint/demo/register',{userId:'alice',password:'wrong-horse'});
  assert.equal(r.status,400);assert.equal(r.body.error,'INVALID_CREDENTIALS');
  r=await call('/bioprint/demo/register',{userId:'alice',password:'correct-horse'});
  assert.equal(r.status,200);assert.equal(r.body.created,false);
  r=await call('/bioprint/demo/register',{userId:'bob',password:'short'});
  assert.equal(r.body.error,'WEAK_PASSWORD');
  assert.equal(accounts.verify('alice','correct-horse'),true);
  assert.equal(accounts.verify('alice','correct-horse '),false);
  assert.equal(accounts.verify('nobody','correct-horse'),false);
  r=await call('/bioprint/profile/alice/status');
  assert.equal(r.body.account,true);assert.equal(r.body.passiveEnrolled,false);
  r=await call('/bioprint/demo/users');
  assert.deepEqual(r.body.users.map(u=>[u.userId,u.account,u.passiveEnrolled]),[['alice',true,false]]);
  // The register response never echoes the password back.
  assert.equal(JSON.stringify(r.body).includes('correct-horse'),false);
});

test('deleting a user removes account, profile and recordings together; clear everything empties the database',async t=>{
  const {call,core,accounts,now}=await serve(t);
  await call('/bioprint/demo/register',{userId:'casey',password:'casey-password'});
  enroll(core,'casey',now);
  await call('/bioprint/demo/register',{userId:'dana',password:'dana-password'});
  const count=(table,user)=>core.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user=?`).get(user).n;
  assert.equal(core.status('casey').passiveEnrolled,true);
  assert.ok(count('passive_sessions','casey')>=PASSIVE_ROUNDS);
  let r=await call('/bioprint/demo/users');
  assert.deepEqual(r.body.users.map(u=>[u.userId,u.passiveEnrolled]),[['casey',true],['dana',false]]);

  r=await call('/bioprint/demo/users/delete',{userId:'casey'});
  assert.equal(r.status,200);assert.equal(r.body.deleted,true);assert.equal(r.body.profile,true);assert.equal(r.body.account,true);
  assert.equal(core.status('casey').enrolled,false);
  assert.equal(accounts.exists('casey'),false);
  for(const table of ['profiles','enrollments','passive_enrollments','sessions','passive_sessions','replay_history','passive_replay','device_enrollments'])assert.equal(count(table,'casey'),0,table);
  assert.equal(core.db.prepare("SELECT count(*) AS n FROM challenges WHERE json_extract(body,'$.userId')='casey'").get().n,0);
  const audit=core.db.prepare('SELECT action FROM audit WHERE user=?').all('casey').map(a=>a.action);
  assert.deepEqual(audit,['user_deleted']);
  assert.equal(accounts.exists('dana'),true);
  r=await call('/bioprint/demo/register',{userId:'casey',password:'a-new-password'});
  assert.equal(r.body.created,true);
  r=await call('/bioprint/demo/users/delete',{userId:'nobody'});
  assert.equal(r.status,200);assert.equal(r.body.profile,false);assert.equal(r.body.account,false);

  r=await call('/bioprint/demo/reset',{});
  assert.equal(r.status,200);assert.equal(r.body.reset,true);assert.equal(r.body.accounts,2);
  assert.equal(accounts.count(),0);assert.deepEqual(core.users(),[]);
  for(const {name} of core.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())
    assert.equal(core.db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n,0,name);
  r=await call('/bioprint/demo/users');assert.deepEqual(r.body.users,[]);
});

test('without demo accounts the /demo routes do not exist and the default verifier fails closed',async t=>{
  const {call,core,now}=await serve(t,{demo:false});
  enroll(core,'erin',now);
  let r=await call('/bioprint/demo/register',{userId:'erin',password:'anything-at-all'});
  assert.equal(r.status,404);
  r=await call('/bioprint/demo/users');assert.equal(r.status,404);
  r=await call('/bioprint/profile/erin/status');assert.equal('account' in r.body,false);
  const c=(await call('/bioprint/login/start',{userId:'erin',device:DEVICE})).body;
  now.t+=60000;
  r=await call('/bioprint/login/verify',{challengeId:c.challengeId,nonce:c.nonce,userId:'erin',username:'erin',events:passiveTrace({user:'erin',seed:900,p:OWNER}),hints:{},password:'anything-at-all'});
  assert.equal(r.status,200);assert.equal(r.body.password,'FAIL');assert.equal(r.body.allowed,false);
});

test('the demo account store lives beside the database file so one wipe removes both',()=>{
  assert.equal(demoAccountsPath(':memory:'),':memory:');
  assert.equal(demoAccountsPath('/tmp/x/bioprint.sqlite'),'/tmp/x/bioprint.sqlite.accounts');
});
