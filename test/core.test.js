import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BioPrint } from '../server/core.js';
import { makeServer } from '../server/http.js';
import { analyze } from '../server/scoring.js';
import { trace, payload, enroll } from './fixtures.js';
const key='test-enrollment-secret';
test('pointer feature is invariant to target distance for equivalent timed paths',()=>{
  const a={phrase:'silent amber river 42',targets:[{x:.2,y:.2},{x:.4,y:.4},{x:.6,y:.6}]};
  const b={...a,targets:[{x:.8,y:.6},{x:.2,y:.7},{x:.8,y:.2}]};
  const x=analyze(a,trace(a)),y=analyze(b,trace(b));
  assert.ok(Math.abs(x.feature[2]-y.feature[2])<1e-10);
});
function setup(t,clock){const c=new BioPrint(':memory:',key,clock);t.after(()=>c.close());return c;}
test('enrollment requires authorization, the minimum accepted rounds, and disallows replacement',t=>{
  const c=setup(t);assert.throws(()=>c.start('alice','bad'),/UNAUTHORIZED/);
  const e=c.start('alice',key);assert.throws(()=>c.complete('alice',e.enrollmentId,e.enrollmentToken),/MORE_ENROLLMENT/);
  assert.throws(()=>c.challenge('alice','enroll',e.enrollmentId,'bad'),/INVALID_ENROLLMENT/);
  assert.equal(c.start('alice',key).enrollmentId,e.enrollmentId);
});
test('valid fixture verifies; consumed challenges and wrong bindings fail closed',t=>{
  const c=setup(t);enroll(c);assert.throws(()=>c.start('alice',key),/ALREADY_ENROLLED/);let ch=c.challenge('alice'),p=payload(ch,trace(ch,{seed:9}));
  assert.equal(c.submit(p,'auth').decision,'ACCEPT');assert.equal(c.submit(p,'auth').reasons[0],'REPLAYED_CHALLENGE');
  ch=c.challenge('alice');p=payload(ch,trace(ch));assert.equal(c.submit({...p,userId:'mallory'},'auth').reasons[0],'CHALLENGE_BINDING_MISMATCH');
  assert.equal(c.submit(p,'auth').reasons[0],'REPLAYED_CHALLENGE');
});
test('expired, wrong-purpose and malformed evidence consume their challenges',t=>{
  let now=1000;const c=setup(t,()=>now);enroll(c);let ch=c.challenge('alice');now+=180000;
  assert.equal(c.submit(payload(ch,trace(ch)),'auth').reasons[0],'EXPIRED_CHALLENGE');
  ch=c.challenge('alice');assert.equal(c.submit(payload(ch,trace(ch)),'enroll').reasons[0],'CHALLENGE_BINDING_MISMATCH');
  ch=c.challenge('alice');const p=payload(ch,[{type:'keydown',key:'x',t:-1}]);assert.equal(c.submit(p,'auth').reasons[0],'INVALID_TIMELINE');assert.equal(c.submit(p,'auth').reasons[0],'REPLAYED_CHALLENGE');
});
test('fresh nonce cannot hide a canonical exact replay',t=>{
  const c=setup(t);enroll(c);const ch=c.challenge('alice'),events=trace(ch,{seed:99});c.submit(payload(ch,events),'auth');
  const next=c.challenge('alice');next.phrase=ch.phrase;next.targets=ch.targets;
  c.db.prepare('UPDATE challenges SET body=? WHERE id=?').run(JSON.stringify(next),next.challengeId);
  const shifted=events.map(e=>({...e,t:e.t+13}));assert.equal(c.submit(payload(next,shifted),'auth').reasons[0],'EXACT_REPLAY');
});
test('quality, automation, task consistency and identity remain separate',t=>{
  const c=setup(t);enroll(c);
  let ch=c.challenge('alice');let r=c.submit(payload(ch,trace(ch,{uniform:true})),'auth');assert.equal(r.reasons[0],'AUTOMATION_RISK');
  ch=c.challenge('alice');r=c.submit(payload(ch,trace(ch,{factor:4,seed:42})),'auth');assert.equal(r.reasons[0],'IDENTITY_MISMATCH');assert.equal(r.humanScore,.85);
  ch=c.challenge('alice');r=c.submit(payload(ch,trace(ch).filter(e=>e.type!=='move')),'auth');assert.equal(r.decision,'MORE_DATA');
  ch=c.challenge('alice');const events=trace(ch);events[0].key='z';r=c.submit(payload(ch,events),'auth');assert.equal(r.allowed,false);
});
test('profiles and consumed challenges survive database reopen',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bioprint-'));let c;
  try{const path=join(dir,'test.sqlite');c=new BioPrint(path,key);enroll(c);const ch=c.challenge('alice'),p=payload(ch,trace(ch,{seed:12}));c.submit(p,'auth');c.close();c=new BioPrint(path,key);assert.equal(c.status('alice').enrolled,true);assert.equal(c.submit(p,'auth').reasons[0],'REPLAYED_CHALLENGE');const fresh=c.challenge('alice');assert.equal(c.submit(payload(fresh,trace(fresh,{seed:13})),'auth').allowed,true);}finally{c?.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP rejects cross-origin and malformed bodies; concurrent duplicate has one winner',async t=>{
  const c=setup(t);enroll(c);const server=makeServer(c,{serveDemo:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/')).status,200);
  const jar=new Map();
  const cookieHeader=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
  const post=async(path,body,extra={})=>{
    const headers={'Content-Type':'application/json',...extra};
    if(jar.size)headers.Cookie=cookieHeader();
    if(jar.has('bioprint_csrf'))headers['X-BioPrint-CSRF']=jar.get('bioprint_csrf');
    const response=await fetch(base+path,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
    for(const line of response.headers.getSetCookie?.()??[]){const [k,v]=line.split(';')[0].split('=');jar.set(k,v);}
    return response;
  };
  assert.equal((await post('/bioprint/auth/challenge',{userId:'alice'},{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/bioprint/auth/challenge','{broken')).status,400);
  const ch=await (await post('/bioprint/auth/challenge',{userId:'alice'})).json();const p=payload(ch,trace(ch,{seed:18}));
  const results=await Promise.all([post('/bioprint/auth/verify',p),post('/bioprint/auth/verify',p)]);const bodies=await Promise.all(results.map(r=>r.json()));
  assert.equal(bodies.filter(r=>r.allowed).length,1);assert.equal(bodies.filter(r=>r.reasons.includes('REPLAYED_CHALLENGE')).length,1);
});
