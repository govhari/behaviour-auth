import { createBehaviorCollector } from './behavior.js';

export function captureContinuous(challenge,{root,roots}={}){
  const areas=(roots??[root]).filter(Boolean);
  if(!areas.length)throw Error('MONITOR_SCOPE_REQUIRED');
  const collectors=areas.map(area=>createBehaviorCollector({root:area,maxEvents:3000,excludePassword:true}));
  return {
    cancel(){for(const c of collectors)c.stop();},
    finish(){
      const events=collectors.flatMap(c=>c.drain()).sort((a,b)=>a.t-b.t);
      for(const c of collectors)c.stop();
      return {challengeId:challenge.challengeId,nonce:challenge.nonce,userId:challenge.userId,monitorId:challenge.monitorId,events,hints:{webdriver:navigator.webdriver===true}};
    },
  };
}
