let s=1;
const rnd=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;};
const jit=(b,sp)=>b+(rnd()-.5)*sp;
export function passiveTrace({user='demo_user',passLen=15,seed=1,p={dwell:95,flight:165,pdwell:88,pflight:158,move:17,bow:.09},submit='pointer'}={}){
  s=seed*7919+13;
  const ev=[];let t=jit(400,200);
  ev.push({type:'focus',field:'username',active:true,t:Math.round(t),trusted:true});
  let pos=0;
  for(const ch of user){
    const d=t,dw=jit(p.dwell,p.dwell*.58);
    ev.push({type:'keydown',field:'username',position:pos,action:'character',key:ch,code:'Key'+ch.toUpperCase(),t:Math.round(d),trusted:true});
    ev.push({type:'keyup',field:'username',position:pos,action:'character',key:ch,code:'Key'+ch.toUpperCase(),t:Math.round(d+dw),trusted:true});
    ev.push({type:'input',field:'username',source:'typing',t:Math.round(d+dw*.4),trusted:true});
    t=d+jit(p.flight,p.flight*.55);pos++;
  }
  ev.push({type:'keydown',field:'username',position:pos,action:'navigation',key:'Tab',code:'Tab',t:Math.round(t),trusted:true});
  ev.push({type:'keyup',field:'username',position:pos,action:'navigation',key:'Tab',code:'Tab',t:Math.round(t+jit(85,40)),trusted:true});
  ev.push({type:'focus',field:'username',active:false,t:Math.round(t+jit(90,20)),trusted:true});
  ev.push({type:'focus',field:'password',active:true,t:Math.round(t+jit(100,20)),trusted:true});
  t+=jit(320,140);pos=0;
  for(let i=0;i<passLen;i++){
    const d=t,dw=jit(p.pdwell,p.pdwell*.57);
    ev.push({type:'keydown',field:'password',position:pos,action:'character',t:Math.round(d),trusted:true});
    ev.push({type:'keyup',field:'password',position:pos,action:'character',t:Math.round(d+dw),trusted:true});
    ev.push({type:'input',field:'password',source:'typing',t:Math.round(d+dw*.4),trusted:true});
    t=d+jit(p.pflight,p.pflight*.54);pos++;
  }
  if(submit==='keyboard'){
    t+=jit(180,80);
    ev.push({type:'keydown',field:'password',position:pos,action:'navigation',t:Math.round(t),trusted:true});
    ev.push({type:'submit',method:'keyboard',t:Math.round(t+jit(6,4)),trusted:true});
    let last=-1;
    return ev.sort((a,b)=>a.t-b.t).map(e=>{if(e.t<last)e.t=last;last=e.t;return e;});
  }
  t+=jit(260,120);
  const x0=.35,y0=.46,x1=.5,y1=.78,N=42;
  for(let i=1;i<=N;i++){
    const u=i/N,bow=Math.sin(u*Math.PI)*p.bow;
    ev.push({type:'move',x:Math.min(1,Math.max(0,x0+(x1-x0)*u+bow*.6+(rnd()-.5)*.004)),
             y:Math.min(1,Math.max(0,y0+(y1-y0)*u-bow*.25+(rnd()-.5)*.004)),
             target:u>.82?'submit':'form',pointerType:'mouse',t:Math.round(t),trusted:true});
    t+=jit(p.move,p.move*.55);
  }
  t+=jit(120,60);
  ev.push({type:'down',x:x1,y:y1,target:'submit',pointerType:'mouse',buttonX:jit(.5,.3),buttonY:jit(.5,.3),t:Math.round(t),trusted:true});
  t+=jit(95,45);
  ev.push({type:'up',x:x1,y:y1,target:'submit',pointerType:'mouse',buttonX:jit(.5,.3),buttonY:jit(.5,.3),t:Math.round(t),trusted:true});
  ev.push({type:'submit',method:'pointer',t:Math.round(t+jit(12,6)),trusted:true});
  let last=-1;
  return ev.sort((a,b)=>a.t-b.t).map(e=>{if(e.t<last)e.t=last;last=e.t;return e;});
}

export function botTrace({user='demo_user',passLen=15,trusted=false,step=100}={}){
  const ev=[];let t=100,pos=0;
  ev.push({type:'focus',field:'username',active:true,t,trusted});
  for(const ch of user){
    ev.push({type:'keydown',field:'username',position:pos,action:'character',key:ch,code:'Key'+ch.toUpperCase(),t,trusted});
    ev.push({type:'keyup',field:'username',position:pos,action:'character',key:ch,code:'Key'+ch.toUpperCase(),t:t+step/2,trusted});
    t+=step;pos++;
  }
  ev.push({type:'keydown',field:'username',position:pos,action:'navigation',key:'Tab',code:'Tab',t,trusted});
  ev.push({type:'keyup',field:'username',position:pos,action:'navigation',key:'Tab',code:'Tab',t:t+step/2,trusted});
  ev.push({type:'focus',field:'username',active:false,t:t+step/2,trusted});
  ev.push({type:'focus',field:'password',active:true,t:t+step/2,trusted});
  t+=step;pos=0;
  for(let i=0;i<passLen;i++){
    ev.push({type:'keydown',field:'password',position:pos,action:'character',t,trusted});
    ev.push({type:'keyup',field:'password',position:pos,action:'character',t:t+step/2,trusted});
    t+=step;pos++;
  }
  t-=step/2;
  for(let i=1;i<=40;i++)ev.push({type:'move',x:.3+.2*i/40,y:.4+.4*i/40,target:i>33?'submit':'form',pointerType:'mouse',t:t+i*10,trusted});
  t+=400;
  ev.push({type:'down',x:.5,y:.8,target:'submit',pointerType:'mouse',buttonX:.5,buttonY:.5,t,trusted});
  ev.push({type:'up',x:.5,y:.8,target:'submit',pointerType:'mouse',buttonX:.5,buttonY:.5,t:t+step/2,trusted});
  ev.push({type:'submit',method:'pointer',t:t+step/2+1,trusted});
  return ev;
}
