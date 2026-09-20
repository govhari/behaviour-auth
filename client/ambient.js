import { createBehaviorCollector } from './behavior.js';

export const AMBIENT_TYPING_BURST = 25;

export function createAmbientSession(sdk,session,{root=document,view=null,studySessionId=null,onWindow=()=>{},onEvent=null}={}){
  const collector=createBehaviorCollector({root,onEvent:event=>{
    if(onEvent)try{onEvent(event);}catch{/* a broken reporter is not a capture failure */}
    if(event.type==='keydown'&&event.action==='character'&&collector.typed()>=AMBIENT_TYPING_BURST)arm(0);
  }});
  const windowMs=Number.isFinite(session.windowMs)?session.windowMs:20000;
  let nonce=session.nonce,timer=null,stopped=false,accepted=0,sent=0,quiet=0,sending=false;
  if(view)collector.setView(view);

  const halt=reason=>{if(stopped)return;stopped=true;clearTimeout(timer);collector.stop();onWindow({stopped:true,reason});};
  const flush=async()=>{
    if(stopped||sending)return;
    if(!collector.size()&&quiet<2){quiet++;return;}
    quiet=0;
    const events=collector.drain();
    if(!events.length)return;
    sending=true;sent++;
    try{
      const result=await sdk.request('/ambient/ingest',{ambientId:session.ambientId,nonce,events,studySessionId,hints:{webdriver:navigator.webdriver===true}});
      nonce=result.nonce??nonce;
      if(result.accepted)accepted++;
      onWindow({...result,sent,accepted,events:events.length});
    }catch(e){
      if(['EXPIRED_AMBIENT_SESSION','INVALID_AMBIENT_SESSION','AMBIENT_BINDING_MISMATCH','AMBIENT_LIMIT_REACHED','INVALID_AMBIENT_WINDOW'].includes(e.message))return halt(e.message);
      onWindow({error:e.message,sent,accepted});
    }finally{sending=false;}
  };
  const arm=delay=>{if(stopped)return;clearTimeout(timer);timer=setTimeout(async()=>{await flush();arm(windowMs);},delay);};
  arm(windowMs);

  return {
    ambientId:session.ambientId,
    windows:()=>accepted,
    pending:()=>collector.size(),
    typed:()=>collector.typed(),
    setView:token=>collector.setView(token),
    flush,
    stop(){halt('STOPPED');sdk.request('/ambient/stop',{ambientId:session.ambientId}).catch(()=>{});},
  };
}
