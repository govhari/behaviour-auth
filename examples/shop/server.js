import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, normalize, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { BioPrint } from '../../server/core.js';
import { createHandler } from '../../server/http.js';
import { loadPolicy } from '../../server/policy.js';
import { createAccounts, USERNAME, SESSION_MS } from './accounts.js';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const SDK=fileURLToPath(new URL('../../client/',import.meta.url));
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.ico':'image/x-icon'};
const SESSION_COOKIE='shop_session';

const BIOPRINT_DB=process.env.BIOPRINT_SHOP_DB??join(tmpdir(),'bioprint-shop.sqlite');
const accounts=createAccounts(process.env.BIOPRINT_SHOP_ACCOUNTS_DB
  ??(BIOPRINT_DB===':memory:'?':memory:':BIOPRINT_DB.replace(/(\.sqlite)?$/,'-accounts.sqlite')));
const core=new BioPrint(
  BIOPRINT_DB,
  randomBytes(24).toString('hex'),
  Date.now,
  {...loadPolicy(process.env.BIOPRINT_POLICY),explain:true,ambientLift:true},
);

const cookie=(req,name)=>(req.headers.cookie??'').match(new RegExp(`(?:^|;\\s*)${name}=([a-zA-Z0-9_-]+)(?:;|$)`))?.[1]??null;
const shopSession=req=>{const id=cookie(req,SESSION_COOKIE);return id?{id,state:accounts.read(id)}:null;};
const setSession=(res,id)=>res.appendHeader('Set-Cookie',`${SESSION_COOKIE}=${id}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS/1000)}`);
const json=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const profileStatus=user=>{try{return core.status(user);}catch{return null;}};

async function body(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw Error('PAYLOAD_TOO_LARGE');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Error('INVALID_JSON');}
}

const bioprint=createHandler(core,{
  basePath:'/bioprint',
  serveDemo:false,
  verifyPassword:(user,password)=>accounts.verify(user,password),
  authorizeEnrollment:(req,payload)=>{
    const session=shopSession(req);
    return !!session?.state&&session.state.enrolling===payload.userId;
  },
  // The decision arrives here before it reaches the browser.
  onDecision:async({req,res,route,body:payload,result})=>{
    const session=shopSession(req);
    const signIn=user=>{
      const id=session?.state?session.id:accounts.open({});
      accounts.update(id,{user,signedInAt:Date.now(),enrolling:null});
      if(!session?.state)setSession(res,id);
    };
    if((route==='/login/verify'||route==='/login/complete')&&result.allowed&&result.loginId)signIn(result.userId??payload.userId);
    if(route==='/enrollment/complete'&&result.enrolled)signIn(payload.userId);
    // Monitoring can withdraw a session it never granted.
    if(route==='/monitor/sample'&&result.reauthenticationRequired&&session?.id)accounts.update(session.id,{user:null});
  },
});

async function serveStatic(req,res,url){
  const path=url==='/'?'/index.html':url;
  const [root,relative]=path.startsWith('/sdk/')?[SDK,path.slice(5)]:[PUBLIC,path.slice(1)];
  const resolved=join(root,normalize(relative).replace(/^(\.\.[/\\])+/,''));
  if(!resolved.startsWith(root))return json(res,403,{error:'FORBIDDEN'});
  try{
    const file=await readFile(resolved);
    res.writeHead(200,{'Content-Type':TYPES[extname(resolved)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(file);
  }catch{json(res,404,{error:'NOT_FOUND'});}
}

async function shopApi(req,res,url){
  const session=shopSession(req);
  if(url==='/api/session'&&req.method==='GET'){
    const user=session?.state?.user??null;
    const status=user?profileStatus(user):null;
    return json(res,200,{user,enrolling:session?.state?.enrolling??null,profile:status,
      enrolled:core.enrollmentCounts(),accounts:accounts.count()});
  }
  if(url==='/api/register'&&req.method==='POST'){
    const payload=await body(req);
    const name=String(payload.username??'').trim();
    if(!USERNAME.test(name))return json(res,400,{error:'INVALID_USERNAME'});
    try{accounts.create(name,payload.password);}catch(e){return json(res,400,{error:e.message});}
    const id=session?.state?session.id:accounts.open({});
    accounts.update(id,{enrolling:name,user:null});
    if(!session?.state)setSession(res,id);
    return json(res,200,{userId:name,enrolling:name});
  }
  if(url==='/api/signin/password'&&req.method==='POST'){
    const payload=await body(req);
    const name=String(payload.username??'').trim();
    if(!accounts.verify(name,payload.password))return json(res,401,{error:'INVALID_CREDENTIALS'});
    const status=profileStatus(name);
    if(status?.passiveEnrolled)return json(res,409,{error:'BEHAVIORAL_LOGIN_REQUIRED'});
    const id=session?.state?session.id:accounts.open({});
    accounts.update(id,{user:name,signedInAt:Date.now(),enrolling:name});
    if(!session?.state)setSession(res,id);
    return json(res,200,{user:name,verified:false,enrolling:name});
  }
  if(url==='/api/account/delete'&&req.method==='POST'){
    const payload=await body(req);
    let name=session?.state?.user??null;
    if(payload.username!==undefined){
      const named=String(payload.username??'').trim();
      if(!accounts.verify(named,payload.password))return json(res,401,{error:'INVALID_CREDENTIALS'});
      name=named;
    }
    if(!name)return json(res,401,{error:'NOT_SIGNED_IN'});
    const removed=core.deleteUser(name);
    accounts.remove(name);
    return json(res,200,{deleted:name,profile:removed.profile});
  }
  if(url==='/api/reset'&&req.method==='POST'){
    await body(req);
    const result=core.reset();
    return json(res,200,{reset:true,accounts:accounts.clear(),rows:result.rows});
  }
  if(url==='/api/signout'&&req.method==='POST'){
    if(session?.id)accounts.update(session.id,{user:null,enrolling:null});
    return json(res,200,{user:null});
  }
  return json(res,404,{error:'NOT_FOUND'});
}

const server=createServer(async(req,res)=>{
  const url=(req.url??'/').split('?')[0];
  try{
    if(await bioprint(req,res))return;
    if(url.startsWith('/api/'))return await shopApi(req,res,url);
    if(req.method!=='GET')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
    return await serveStatic(req,res,url);
  }catch(e){
    const known=/^[A-Z_]+$/.test(e.message);
    if(!known)console.error(e);
    json(res,known?400:500,{error:known?e.message:'INTERNAL_ERROR'});
  }
});

const port=Number(process.env.PORT??3210);
const host=process.env.HOST??'127.0.0.1';
server.listen(port,host,()=>console.log(`Shop example on http://${host==='0.0.0.0'?'localhost':host}:${port}${host==='0.0.0.0'?' (all interfaces)':''}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{core.close();accounts.shutdown();process.exit(0);}));
