const categorize = e =>
  e.key==='Backspace'||e.key==='Delete' ? 'correction'
  : e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey ? 'character'
  : ['Shift','Control','Alt','Meta','CapsLock'].includes(e.key) ? 'modifier'
  : 'navigation';

export function createBehaviorCollector({root=document,maxEvents=4000,moveIntervalMs=40,scrollIntervalMs=60,excludePassword=true,onEvent=null}={}){
  const controller=new AbortController(),signal=controller.signal;
  const whole=root===document||root===document.documentElement||root===document.body;
  const target=whole?document:root;
  const frame=()=>whole
    ? {left:0,top:0,width:window.innerWidth||1,height:window.innerHeight||1}
    : root.getBoundingClientRect();
  let events=[],origin=performance.now(),last=0,position=0,dropped=0,typed=0;
  const held=new Map(),skipKeys=new Set();
  let pressed=false,skipUp=false,lastMove=-Infinity,lastScroll=-Infinity;

  const push=(source,data)=>{
    const t=Math.max(last,performance.now()-origin);last=t;
    if(events.length>=maxEvents){events.shift();dropped++;}
    const event={...data,t,trusted:source?.isTrusted!==false};
    events.push(event);
    if(onEvent)try{onEvent(event);}catch{/* a broken reporter is not a capture failure */}
  };
  const listen=(el,type,fn,options={})=>el?.addEventListener(type,fn,{...options,signal});
  const inPassword=e=>excludePassword&&e.target?.tagName==='INPUT'&&e.target?.type==='password';
  const point=e=>{const r=frame();return {x:(e.clientX-r.left)/Math.max(1,r.width),y:(e.clientY-r.top)/Math.max(1,r.height)};};

  listen(target,'keydown',e=>{
    if(e.repeat||e.isComposing||e.key==='Process'||e.key==='Unidentified'||inPassword(e))return;
    const id=e.code||e.key;if(held.has(id))return;
    const entry={position:position++,action:categorize(e)};held.set(id,entry);
    if(entry.action==='character')typed++;
    push(e,{type:'keydown',position:entry.position,action:entry.action});
  },{capture:true});
  listen(target,'keyup',e=>{
    const id=e.code||e.key,entry=held.get(id);if(!entry)return;held.delete(id);
    if(skipKeys.delete(id))return;
    push(e,{type:'keyup',position:entry.position,action:entry.action});
  },{capture:true});

  for(const [name,type] of [['pointermove','move'],['pointerdown','down'],['pointerup','up']])listen(target,name,e=>{
    if(!e.isPrimary)return;
    if(type==='move'){if(performance.now()-lastMove<moveIntervalMs)return;lastMove=performance.now();}
    if(type==='down'){if(pressed)return;pressed=true;}
    if(type==='up'){if(!pressed)return;pressed=false;if(skipUp){skipUp=false;return;}}
    const {x,y}=point(e);if(!(x>=0&&x<=1&&y>=0&&y<=1))return;
    push(e,{type,x,y,...(e.pointerType&&['mouse','touch','pen'].includes(e.pointerType)?{pointerType:e.pointerType}:{})});
  },{capture:true});
  listen(target,'pointercancel',e=>{pressed=false;skipUp=false;push(e,{type:'focus',active:false});},{capture:true});

  const depth=()=>{
    if(whole){const d=document.documentElement;return d.scrollHeight>d.clientHeight?d.scrollTop/(d.scrollHeight-d.clientHeight):0;}
    return root.scrollHeight>root.clientHeight?root.scrollTop/(root.scrollHeight-root.clientHeight):0;
  };
  listen(whole?document:root,'scroll',e=>{
    if(performance.now()-lastScroll<scrollIntervalMs)return;lastScroll=performance.now();
    const position=depth();if(Number.isFinite(position))push(e,{type:'scroll',position:Math.max(0,Math.min(1,position))});
  },{capture:true,passive:true});
  listen(target,'wheel',e=>{if(Number.isFinite(e.deltaY))push(e,{type:'wheel',deltaY:Math.max(-1e6,Math.min(1e6,e.deltaY)),deltaMode:e.deltaMode});},{capture:true,passive:true});

  listen(document,'visibilitychange',e=>push(e,{type:'focus',active:!document.hidden}));
  listen(window,'blur',e=>push(e,{type:'focus',active:false}));
  listen(window,'focus',e=>push(e,{type:'focus',active:true}));

  return {
    size:()=>events.length,
    dropped:()=>dropped,
    typed:()=>typed,
    setView(view){if(typeof view==='string'&&/^[a-zA-Z0-9_-]{1,32}$/.test(view))push(null,{type:'view',view});},
    drain(){
      const batch=events;events=[];
      const pending=new Set([...held.values()].map(entry=>entry.position));
      for(const id of held.keys())skipKeys.add(id);
      const out=batch.filter(e=>!(e.type==='keydown'&&pending.has(e.position)));
      if(pressed){const index=out.map(e=>e.type).lastIndexOf('down');if(index>=0)out.splice(index,1);skipUp=true;}
      origin=performance.now();last=0;position=0;typed=0;
      return out;
    },
    stop(){controller.abort();events=[];held.clear();skipKeys.clear();},
  };
}
