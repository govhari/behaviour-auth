import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BioPrint } from './core.js';
import { randomBytes, createHash } from 'node:crypto';
import { loadPolicy } from './policy.js';
import { LOCAL_ENROLLMENT_KEY } from '../client/local-demo.js';
import { createDemoAccounts, demoAccountsPath } from './demo-accounts.js';

const DEMO_FILES={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/sdk.js':['sdk.js','text/javascript'],'/bioprint.js':['bioprint.js','text/javascript'],'/stepup.js':['stepup.js','text/javascript'],'/passive.js':['passive.js','text/javascript'],'/continuous.js':['continuous.js','text/javascript'],'/behavior.js':['behavior.js','text/javascript'],'/ambient.js':['ambient.js','text/javascript'],'/local-demo.js':['local-demo.js','text/javascript'],'/dashboard.js':['dashboard.js','text/javascript'],'/style.css':['style.css','text/css']};

const rejectAll=()=>false;

export function createHandler(core,{
  demoAccounts=null,
  verifyPassword=demoAccounts?((user,password)=>demoAccounts.verify(user,password)):rejectAll,
  basePath='/bioprint',
  allowedOrigins=null,
  serveDemo=false,
  authorizeEnrollment=null,
  onDecision=null,
  rateLimit={max:120,windowMs:60000},
  crossSite=false,
  csrf=true,
  secureCookies=crossSite,
}={}){
  const rates=new Map();
  const base=basePath.replace(/\/$/,'');
  const originAllowed=origin=>{
    if(typeof allowedOrigins==='function')return allowedOrigins(origin);
    if(Array.isArray(allowedOrigins))return allowedOrigins.includes(origin);
    return false;
  };
  return async (req,res)=>{
    const url=(req.url??'').split('?')[0];
    const route=url===base?'/':url.startsWith(base+'/')?url.slice(base.length):null;
    const demo=serveDemo&&req.method==='GET'&&DEMO_FILES[url];
    if(route===null&&!demo)return false;

    const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return true;};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(serveDemo)res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");

    const origin=req.headers.origin;
    const sameOrigin=!origin||origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`;
    if(!sameOrigin){
      if(!originAllowed(origin))return send(403,{error:'ORIGIN_REJECTED'});
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Access-Control-Allow-Credentials','true');
      res.setHeader('Vary','Origin');
    }
    if(req.method==='OPTIONS'){
      res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Enrollment-Key, X-BioPrint-CSRF','Access-Control-Max-Age':'600'});
      res.end();return true;
    }
    try{
      if(demo){const [file,type]=DEMO_FILES[url];res.writeHead(200,{'Content-Type':type});res.end(readFileSync(new URL('../client/'+file,import.meta.url)));return true;}
      if(req.method==='GET'){
        if(demoAccounts&&route==='/demo/users'){
          const names=new Set([...demoAccounts.list().map(u=>u.name),...core.users()]);
          return send(200,{users:[...names].sort().map(name=>{const st=core.status(name);return {userId:name,account:demoAccounts.exists(name),enrolled:st.enrolled,passiveEnrolled:st.passiveEnrolled,passiveRounds:st.passiveRounds,trustedDevices:st.trustedDevices};})});
        }
        const match=route.match(/^\/profile\/([a-zA-Z0-9_-]{1,64})\/status$/);
        if(!match)return send(404,{error:'NOT_FOUND'});
        const status=core.status(match[1]);
        return send(200,demoAccounts?{...status,account:demoAccounts.exists(match[1])}:status);
      }
      if(req.method!=='POST')return send(404,{error:'NOT_FOUND'});

      const now=Date.now(),address=req.socket.remoteAddress;
      for(const [key,value] of rates)if(value.until<now)rates.delete(key);
      const bucket=rates.get(address)??{count:0,until:now+rateLimit.windowMs};rates.set(address,bucket);
      if(++bucket.count>rateLimit.max){res.setHeader('Retry-After',Math.ceil((bucket.until-now)/1000));return send(429,{error:'RATE_LIMITED'});}
      if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON_REQUIRED'});

      const cookies=req.headers.cookie??'';
      const flags=`Max-Age=86400; SameSite=${crossSite?'None':'Strict'}${secureCookies?'; Secure':''}`;
      const setCookies=[];
      let session=cookies.match(/(?:^|;\s*)bioprint_session=([a-f0-9]{48})(?:;|$)/)?.[1];
      if(!session){session=randomBytes(24).toString('hex');setCookies.push(`bioprint_session=${session}; HttpOnly; Path=${base||'/'}; ${flags}`);}
      let token=cookies.match(/(?:^|;\s*)bioprint_csrf=([a-f0-9]{32})(?:;|$)/)?.[1];
      if(csrf&&token&&req.headers['x-bioprint-csrf']!==token)return send(403,{error:'CSRF_TOKEN_MISMATCH'});
      if(csrf&&!token){token=randomBytes(16).toString('hex');setCookies.push(`bioprint_csrf=${token}; Path=/; ${flags}`);}
      if(setCookies.length)res.setHeader('Set-Cookie',setCookies);
      const binding=createHash('sha256').update(session).digest('hex');

      const chunks=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)return send(413,{error:'PAYLOAD_TOO_LARGE'});chunks.push(chunk);}
      let b;try{b=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{return send(400,{error:'INVALID_JSON'});}
      if(!b||Array.isArray(b)||typeof b!=='object')return send(400,{error:'INVALID_BODY'});

      const enrollmentKey=authorizeEnrollment
        ? (await authorizeEnrollment(req,b)?core.key:null)
        : req.headers['x-enrollment-key'];

      let result;
      if(demoAccounts&&route.startsWith('/demo/')){
        if(route==='/demo/register'){
          core.validUser(b.userId);
          if(demoAccounts.exists(b.userId)){
            if(!demoAccounts.verify(b.userId,b.password))throw Error('INVALID_CREDENTIALS');
            result={userId:b.userId,created:false};
          }else result={...demoAccounts.create(b.userId,b.password),created:true};
          result.passiveEnrolled=core.status(b.userId).passiveEnrolled;
        }else if(route==='/demo/users/delete'){
          result={...core.deleteUser(b.userId),account:demoAccounts.remove(b.userId)};
        }else if(route==='/demo/reset'){
          result={...core.reset(),accounts:demoAccounts.clear()};
        }else return send(404,{error:'NOT_FOUND'});
        delete b.password;
        return send(200,csrf?{...result,csrfToken:token}:result);
      }
      switch(route){
        case '/ambient/start':result=core.startAmbient(b,binding);break;
        case '/ambient/ingest':result=core.ingestAmbient(b,binding);break;
        case '/ambient/stop':result=core.stopAmbient(b,binding);break;
        case '/enrollment/start':result=core.startEnrollmentFlow(b.userId,enrollmentKey);break;
        case '/enrollment/device/start':result=core.startDeviceEnrollment(b.userId,enrollmentKey,b.device,binding);break;
        case '/enrollment/passive/challenge':result=core.passiveChallenge(b.userId,'passive-enroll',b.device,binding,b);break;
        case '/enrollment/passive/sample':result=core.submitPassive(b,'passive-enroll',binding);break;
        case '/enrollment/complete':result=core.completeEnrollmentFlow(b.userId,b,binding);break;
        case '/login/start':result=core.passiveChallenge(b.userId,'passive-auth',b.device,binding);break;
        case '/login/verify':{
          const valid=await verifyPassword(b.userId,b.password);
          delete b.password;result=core.submitPassive(b,'passive-auth',binding,valid===true);break;
        }
        case '/login/challenge':result=core.stepUpChallenge(b,binding);break;
        case '/login/complete':result=core.finishStepUp(b,binding);break;
        case '/monitor/start':result=core.startMonitoring(b,binding);break;
        case '/monitor/challenge':result=core.monitorChallenge(b,binding);break;
        case '/monitor/sample':result=core.submitMonitor(b,binding);break;
        case '/monitor/stop':result=core.stopMonitoring(b,binding);break;
        case '/enroll/start':result=core.start(b.userId,enrollmentKey);break;
        case '/enroll/challenge':result=core.challenge(b.userId,'enroll',b.enrollmentId,b.enrollmentToken,b.device,binding);break;
        case '/enroll/sample':result=core.submit(b,'enroll',binding);break;
        case '/enroll/complete':result=core.complete(b.userId,b.enrollmentId,b.enrollmentToken);break;
        case '/auth/challenge':result=core.challenge(b.userId,'auth',undefined,undefined,b.device,binding);break;
        case '/auth/verify':result=core.submit(b,'auth',binding);break;
        default:return send(404,{error:'NOT_FOUND'});
      }
      if(onDecision)await onDecision({req,res,route,body:b,result,session});
      return send(200,csrf?{...result,csrfToken:token}:result);
    }catch(e){
      const known=/^[A-Z_]+$/.test(e.message);
      if(!known)console.error(e);
      return send(known?400:500,{error:known?e.message:'INTERNAL_ERROR'});
    }
  };
}

export function middleware(core,options={}){
  const handler=createHandler(core,options);
  return (req,res,next)=>{handler(req,res).then(handled=>{if(!handled&&next)next();}).catch(error=>next?next(error):(res.statusCode=500,res.end()));};
}

export function makeServer(core,options={}){
  const handler=createHandler(core,options);
  return createServer(async(req,res)=>{
    if(!await handler(req,res)){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'NOT_FOUND'}));}
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const dir=fileURLToPath(new URL('../data/',import.meta.url));mkdirSync(dir,{recursive:true,mode:0o700});
  const dbPath=process.env.BIOPRINT_DB??join(dir,'bioprint.sqlite');
  const core=new BioPrint(dbPath,LOCAL_ENROLLMENT_KEY,Date.now,{explain:process.env.BIOPRINT_EXPLAIN!=='0',...loadPolicy(process.env.BIOPRINT_POLICY)});
  const demoAccounts=createDemoAccounts(demoAccountsPath(dbPath));
  const server=makeServer(core,{serveDemo:true,demoAccounts,allowedOrigins:process.env.BIOPRINT_ORIGINS?.split(',').map(s=>s.trim()).filter(Boolean)??null,crossSite:process.env.BIOPRINT_CROSS_SITE==='1'});
  const host=process.env.HOST??'127.0.0.1';
  server.listen(Number(process.env.PORT??3000),host,()=>console.log(`BioPrint listening on http://${host}:${server.address().port}${host==='0.0.0.0'?' (all interfaces)':''}`));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>{core.close();demoAccounts.close();process.exit(0);}));
}
